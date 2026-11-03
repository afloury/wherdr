import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfAuthDb, pdfSession } from './pdfAuth.mjs'
import fixture from '../fixtures/core-0.1.16.json' with { type: 'json' }

// v3 smoke test (CI on pull requests to v3): the home loads from a fake herdr-core
// socket, a terminal card shows, and opening it attaches the live terminal.
// Own isolated server (needs `WHERDR_BACKEND=core NUXT_PUBLIC_CORE=true npm run build`).
test('core attach: '+' → file on a core agent inserts the path in the message', async ({ page }) => {
  const data = await mkdtemp(join(tmpdir(), 'core-smoke-'))
  const socketPath = join(data, 'core.sock')
  await writeFile(join(data, 'auth.json'), JSON.stringify(pdfAuthDb))
  await writeFile(join(data, 'push.json'), '{"subs":[]}')
  const probe = createServer()
  let port = 7690
  for (; port <= 7699; port++) {
    if (await new Promise<boolean>(resolve => {
      probe.once('error', () => resolve(false))
      probe.listen(port, '127.0.0.1', () => resolve(true))
    })) break
  }
  if (port > 7699) throw new Error('No free isolated test port')
  await new Promise<void>(resolve => probe.close(() => resolve()))
  const server = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data,
      WHERDR_BACKEND: 'core', NUXT_PUBLIC_CORE: 'true', HC_SOCKET: socketPath, HERDR_WEB_MACHINES: 'off' }, stdio: 'ignore',
  })
  // Framed relay: [channel u32][kind u8][len u32][payload].
  const frame = (channel: number, kind: number, payload: Buffer) => {
    const head = Buffer.alloc(9)
    head.writeUInt32LE(channel, 0)
    head.writeUInt8(kind, 4)
    head.writeUInt32LE(payload.length, 5)
    return Buffer.concat([head, payload])
  }
  const attached: string[] = []
  const puts: string[] = []
  const core = createServer(socket => socket.once('data', first => {
    const r = JSON.parse(first.toString().split('\n')[0]!)
    if (r.method === 'hello' && r.params?.framed) {
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: { ...fixture.hello, framed: true } }) + '\n')
      let buf = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 9 && buf.length >= 9 + buf.readUInt32LE(5)) {
          const channel = buf.readUInt32LE(0)
          const payload = buf.subarray(9, 9 + buf.readUInt32LE(5))
          buf = buf.subarray(9 + payload.length)
          if (channel) continue
          const call = JSON.parse(payload.toString())
          const result = call.method === 'events.subscribe'
            ? { channel: 2, seq: 1, terminals: [{ ...fixture.inventory.terminals[0], cols: 80, rows: 24 }] } : { channel: 3 }
          socket.write(frame(0, 0, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }))))
          if (call.method === 'terminal.attach') {
            attached.push(call.params.terminal)
            socket.write(frame(3, 0, Buffer.from('hello from core\r\n')))
          }
        }
      })
      return
    }
    if (r.method === 'terminal.put') puts.push(r.params.terminal)
    const result = r.method === 'hello' ? fixture.hello
      : r.method === 'terminal.list' ? { ...fixture.inventory, terminals: [{ ...fixture.inventory.terminals[0], labels: { 'herdr.space': 'sp1', 'herdr.tab': 'tbA' } }] }
      : r.method === 'doc.get' ? { value: r.params.on ? null : { spaces: [{ id: 'sp1', name: 'Demo', folder: '/workspace/demo', tabs: [{ id: 'tbA', name: 'Main' }] }] }, version: 1 }
      : r.method === 'terminal.put' ? { path: `/remote/${r.params.name}` }
      : r.method === 'machine.list' ? { machines: [{ name: 'host-a', state: 'connected' }] } : fixture.discover
    socket.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n')
  }))
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok } catch { return false } }).toBe(true)
    await page.context().addCookies([{ name: 'hw_session', value: pdfSession(), url: `http://localhost:${port}` }])
    await new Promise<void>(resolve => core.listen(socketPath, resolve))
    await page.goto(`http://localhost:${port}`)
    await expect(page.locator('.home-version')).toHaveText(/^wherdr v3 · herdr-core$/i)
    const card = page.getByRole('button', { name: /review-agent/ }).first()
    await expect(card).toBeVisible()
    await card.click()
    await expect(page).toHaveURL(/#\/(a|t)\//)
    await expect(page.locator('.agent-top')).toBeVisible()
    await page.getByTestId('attach-any').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect.poll(() => puts).toContain(fixture.inventory.terminals[0]!.address)
    await expect(page.getByText('notes.txt')).toBeVisible()
    expect(page.url()).toMatch(/s[0-9a-z]+:p/)
    await expect(page.getByText('Invalid pane')).toHaveCount(0)
    await page.screenshot({ path: '.shots/core-attach.png' })
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM')
      await new Promise<void>(resolve => server.once('exit', () => resolve()))
    }
    if (core.listening) await new Promise<void>(resolve => core.close(() => resolve()))
    await rm(data, { recursive: true, force: true })
  }
})
