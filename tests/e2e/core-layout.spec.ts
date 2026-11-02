import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfAuthDb, pdfSession } from './pdfAuth.mjs'
import fixture from '../fixtures/core-0.1.16.json' with { type: 'json' }

// Own isolated server on a fake core: machines as tabs, herdr-app spaces and tabs from
// the herdr.space / herdr.tab labels and the "herdr-app" document, and "+" = a new terminal.
test('core home: one bar item per machine, spaces and tabs of herdr-app, new tab in a space', async ({ page }) => {
  const data = await mkdtemp(join(tmpdir(), 'core-layout-'))
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
  const label = (space: string, tab: string) => ({ 'herdr.space': space, 'herdr.tab': tab })
  const terminals: Record<string, unknown>[] = [
    { address: 't1', name: 'main', cwd: '/workspace/app', state: 'live', labels: label('sp1', 'tbA') },
    { address: 't2', name: 'side', cwd: '/workspace/app', state: 'live', labels: label('sp1', 'tbA') },
    { address: 't3', name: 'logs', cwd: '/workspace/app', state: 'live', labels: label('sp1', 'tbB') },
    { address: 'box/t1', name: 'far', cwd: '/srv', state: 'live', status: { state: 'working' } },
  ]
  const docs: Record<string, unknown> = {
    '': { spaces: [{ id: 'sp1', name: 'Shop', folder: '/workspace/app', tabs: [{ id: 'tbA', name: 'Main' }, { id: 'tbB', name: 'Logs' }] }] },
  }
  const rpc: { method: string, params: any }[] = []
  const execOut = (script: string) => script.startsWith('printf') ? '/workspace' : script.includes('command -v') ? 'claude\n' : ''
  const core = createServer(socket => socket.once('data', (chunk) => {
    const r = JSON.parse(chunk.toString().split('\n')[0]!)
    rpc.push(r)
    const result = r.method === 'hello' ? fixture.hello
      : r.method === 'terminal.list' ? { ...fixture.inventory, terminals }
      : r.method === 'machine.list' ? { machines: [{ name: 'box', state: 'connected' }] }
      : r.method === 'doc.get' ? { value: docs[r.params.on ?? ''] ?? null, version: 1 }
      : r.method === 'machine.exec' ? { code: 0, timed_out: false, stdout: Buffer.from(execOut(r.params.argv[2])).toString('base64') }
      : r.method === 'terminal.run' ? { address: 'te1' } : fixture.discover
    if (r.method === 'terminal.run') terminals.push({ address: 'te1', cwd: r.params.cwd, state: 'live', labels: r.params.labels })
    socket.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n')
  }))
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok } catch { return false } }).toBe(true)
    await page.context().addCookies([{ name: 'hw_session', value: pdfSession(), url: `http://localhost:${port}` }])
    await page.goto(`http://localhost:${port}`)
    await new Promise<void>(resolve => core.listen(socketPath, resolve))
    // One item per machine with its counter, offline or online.
    await expect(page.locator('[data-bar-id]')).toHaveText([/ALL\s*4/i, /LOCAL\s*3/i, /BOX\s*1/i])
    // The three terminals of the "Shop" space make one workspace row.
    await expect(page.locator('.card').filter({ hasText: 'Shop' })).toHaveCount(1)
    // A single-tab space has its "+" in the header on a computer (as in v2.5).
    if (!page.viewportSize() || page.viewportSize()!.width > 800) {
      await page.locator('.card').filter({ hasText: 'srv' }).first().click()
      await expect(page.getByRole('button', { name: 'New tab' })).toBeVisible()
    }
    await page.locator('.card').filter({ hasText: 'Shop' }).first().click()
    await expect(page.locator('.space-tabs .tab-chip')).toHaveText([/MAIN/i, /LOGS/i, ''])
    const spaceUrl = page.url()
    // "+": a new terminal labelled for the same space, in a new tab.
    await page.locator('.tab-add').click()
    await page.locator('[data-kind="shell"]').click()
    await page.getByRole('button', { name: /launch/i }).click()
    await expect.poll(() => rpc.find(r => r.method === 'terminal.run')?.params.labels).toMatchObject({ 'herdr.space': 'sp1', 'herdr.seen': '0' })
    await expect(page).toHaveURL(/#\/a\//)
    await page.goto(spaceUrl)
    await expect(page.locator('.space-tabs .tab-chip')).toHaveCount(4)
    expect(rpc.filter(r => r.method === 'terminal.run')).toHaveLength(1)
  } finally {
    core.close()
    server.kill()
    await rm(data, { recursive: true, force: true })
  }
})
