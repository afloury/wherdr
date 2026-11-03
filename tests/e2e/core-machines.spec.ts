import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfAuthDb, pdfSession } from './pdfAuth.mjs'
import fixture from '../fixtures/core-0.1.16.json' with { type: 'json' }

// Settings > Machines on herdr-core: core line, rename, forget (own isolated server and fake core).
test('machines can be renamed and forgotten, and the core line shows', async ({ page }) => {
  const data = await mkdtemp(join(tmpdir(), 'core-machines-'))
  const socketPath = join(data, 'core.sock')
  await writeFile(join(data, 'auth.json'), JSON.stringify(pdfAuthDb))
  await writeFile(join(data, 'push.json'), '{"subs":[]}')
  const probe = createServer()
  let port = 7690
  for (; port <= 7699; port++) {
    if (await new Promise<boolean>(resolve => { probe.once('error', () => resolve(false)); probe.listen(port, '127.0.0.1', () => resolve(true)) })) break
  }
  if (port > 7699) throw new Error('No free isolated test port')
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data,
      WHERDR_BACKEND: 'core', NUXT_PUBLIC_CORE: 'true', HC_SOCKET: socketPath, HERDR_WEB_MACHINES: 'off' }, stdio: 'ignore',
  })
  const rpc: { method: string, params: any }[] = []
  const machineList = [{ name: 'host-a', state: 'connected' }, { name: 'host-b', state: 'unreachable', why: 'a different core answers there' }]
  const core = createServer(socket => socket.once('data', (data) => {
    const r = JSON.parse(data.toString().split('\n')[0]!)
    rpc.push(r)
    const result = r.method === 'hello' ? fixture.hello
      : r.method === 'terminal.list' ? { ...fixture.inventory, terminals: [] }
      : r.method === 'machine.list' ? { machines: machineList }
      : r.method === 'server.status' ? { core: { id: 'x', name: 'core-a' }, version: '0.1.17', pid: 1, uptime_ms: 3 * 3600 * 1000, holders: [], live: 0, finished: 0 }
      : r.method === 'machine.add' ? { name: 'box' }
      : r.method === 'machine.rename' || r.method === 'machine.rm' ? { removed: r.params.machine } : fixture.discover
    if (r.method === 'machine.rename') machineList.find(m => m.name === r.params.machine)!.name = r.params.new_name
    if (r.method === 'machine.rm') machineList.splice(machineList.findIndex(m => m.name === r.params.machine), 1)
    socket.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n')
  }))
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok } catch { return false } }).toBe(true)
    await page.context().addCookies([{ name: 'hw_session', value: pdfSession(), url: `http://localhost:${port}` }])
    await new Promise<void>(resolve => core.listen(socketPath, resolve))
    await page.goto(`http://localhost:${port}/#/settings?section=agents`)
    await expect(page.getByTestId('core-machine').first()).toContainText('host-a')
    await expect(page.getByTestId('core-line')).toContainText('Core 0.1.17 · running for 3 h')
    await mkdir('.shots', { recursive: true })
    await page.screenshot({ path: `.shots/core-machines-${test.info().project.name}.png` })
    // host:port on a 0.1.17+ core goes through; the old-core message is covered by unit tests.
    await page.getByLabel('SSH target').fill('me@10.0.0.9:2222')
    await page.getByRole('button', { name: 'Add machine' }).click()
    await expect.poll(() => rpc.find(r => r.method === 'machine.add')?.params).toEqual({ target: 'me@10.0.0.9:2222' })
    await page.getByTestId('core-machine').filter({ hasText: 'host-a' }).getByTestId('machine-rename').click()
    await page.getByLabel('Name', { exact: true }).fill('renamed')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('core-machine').filter({ hasText: 'renamed' })).toBeVisible()
    expect(rpc.find(r => r.method === 'machine.rename')?.params).toEqual({ machine: 'host-a', new_name: 'renamed' })
    // No ghost: the old name is gone at once and the row count is unchanged.
    await expect(page.getByTestId('core-machine').filter({ hasText: 'host-a' })).toHaveCount(0)
    await expect(page.getByTestId('core-machine')).toHaveCount(2)
    await page.getByTestId('core-machine').filter({ hasText: 'renamed' }).getByTestId('machine-forget').click()
    await expect(page.getByText(/Forget renamed\?.*terminals keep running there/i)).toBeVisible()
    await page.screenshot({ path: `.shots/core-machines-forget-${test.info().project.name}.png` })
    await page.getByRole('button', { name: 'Forget', exact: true }).click()
    await expect(page.getByTestId('core-machine').filter({ hasText: 'renamed' })).toHaveCount(0)
    expect(rpc.find(r => r.method === 'machine.rm')?.params).toEqual({ machine: 'renamed' })
  } finally {
    if (server.exitCode === null) { server.kill('SIGTERM'); await new Promise<void>(resolve => server.once('exit', () => resolve())) }
    if (core.listening) await new Promise<void>(resolve => core.close(() => resolve()))
    await rm(data, { recursive: true, force: true })
  }
})
