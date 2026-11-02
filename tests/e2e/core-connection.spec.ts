import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fixture from '../fixtures/core-0.1.16.json' with { type: 'json' }

// Own isolated server: the normal e2e launcher remains on the v2 backend.
test('core preview reports connection failures and retries without legacy requests', async ({ page }) => {
  const data = await mkdtemp(join(tmpdir(), 'core-preview-'))
  const socketPath = join(data, 'core.sock')
  const portProbe = createServer()
  let port = 7690
  for (; port <= 7699; port++) {
    if (await new Promise<boolean>(resolve => {
      portProbe.once('error', () => resolve(false))
      portProbe.listen(port, '127.0.0.1', () => resolve(true))
    })) break
  }
  if (port > 7699) throw new Error('No free isolated test port')
  await new Promise<void>(resolve => portProbe.close(() => resolve()))
  await writeFile(join(data, 'push.json'), '{"subs":[]}')
  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data,
      WHERDR_BACKEND: 'core', NUXT_PUBLIC_CORE: 'true', HC_SOCKET: socketPath, HERDR_WEB_MACHINES: 'off' }, stdio: 'ignore',
  })
  let compatible = false
  const core = createServer(socket => socket.once('data', data => {
    const r = JSON.parse(data.toString())
    const result = r.method === 'hello' ? { ...fixture.hello, generation: compatible ? 1 : 2 } : fixture.discover
    socket.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n')
  }))
  const requests: string[] = []
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(new URL(r.url()).pathname) })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok } catch { return false } }).toBe(true)
    await page.goto(`http://127.0.0.1:${port}`)
    await expect(page.getByRole('alert')).toContainText('Cannot connect to herdr-core')
    await mkdir('.shots', { recursive: true })
    await page.screenshot({ path: '.shots/core-phone.png' })
    await new Promise<void>(resolve => core.listen(socketPath, resolve))
    await page.getByRole('button', { name: 'Retry connection' }).click()
    await expect(page.getByRole('alert')).toContainText('Incompatible herdr-core')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: '.shots/core-desktop.png' })
    compatible = true
    await page.getByRole('button', { name: 'Retry connection' }).click()
    await expect(page.getByRole('status')).toContainText('Connected to herdr-core · 0.1.16')
    expect(requests.filter(p => p !== '/api/core')).toEqual([])
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM')
      await new Promise<void>(resolve => server.once('exit', () => resolve()))
    }
    if (core.listening) await new Promise<void>(resolve => core.close(() => resolve()))
    await rm(data, { recursive: true, force: true })
  }
})
