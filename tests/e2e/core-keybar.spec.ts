import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfAuthDb, pdfSession } from './pdfAuth.mjs'
import fixture from '../fixtures/core-0.1.16.json' with { type: 'json' }

// From the conversation (no terminal attached), the phone key bar's navigation keys reach
// herdr-core by the names its terminal.keys accepts (home, pageup...), not as v2 Herdr's
// CSI workaround bytes that /api/input refuses on core.
// Own isolated server (needs `WHERDR_BACKEND=core NUXT_PUBLIC_CORE=true npm run build`).
test('conversation key bar: Home, End, PgUp, PgDn, Delete and Insert reach core', async ({ page }) => {
  const data = await mkdtemp(join(tmpdir(), 'core-keybar-'))
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
  const frame = (channel: number, payload: Buffer) => {
    const head = Buffer.alloc(9)
    head.writeUInt32LE(channel, 0)
    head.writeUInt32LE(payload.length, 5)
    return Buffer.concat([head, payload])
  }
  const terminal = fixture.inventory.terminals[0]!
  const keys: string[][] = []
  const core = createServer(socket => socket.once('data', (first) => {
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
          const result = call.method === 'events.subscribe' ? { channel: 2, seq: 1, terminals: [{ ...terminal, cols: 80, rows: 24 }] } : { channel: 3 }
          socket.write(frame(0, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }))))
        }
      })
      return
    }
    if (r.method === 'terminal.keys') keys.push(r.params.keys)
    const result = r.method === 'hello' ? fixture.hello
      : r.method === 'terminal.list' ? fixture.inventory
      : r.method === 'terminal.keys' ? { status: null, turn: 0 }
      : r.method === 'machine.list' ? { machines: [{ name: 'host-a', state: 'connected' }] } : fixture.discover
    socket.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n')
  }))
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok } catch { return false } }).toBe(true)
    await page.context().addCookies([{ name: 'hw_session', value: pdfSession(), url: `http://localhost:${port}` }])
    await new Promise<void>(resolve => core.listen(socketPath, resolve))
    await page.goto(`http://localhost:${port}`)
    await page.getByRole('button', { name: /review-agent/ }).first().click()
    await expect(page.locator('.agent-top')).toBeVisible()
    const toChat = page.getByRole('button', { name: 'Conversation', exact: true })
    if (await toChat.count() && await toChat.getAttribute('aria-pressed') === 'false') await toChat.click()
    await page.getByRole('button', { name: 'Show or hide terminal keys', exact: true }).click()
    const bar = page.getByRole('group', { name: 'Terminal function keys', exact: true })
    const names = { Home: 'home', End: 'end', PgUp: 'pageup', PgDn: 'pagedown', Delete: 'delete', Insert: 'insert' }
    for (const name of Object.keys(names)) {
      const response = page.waitForResponse(r => r.url().endsWith('/api/input') && r.request().method() === 'POST')
      await bar.getByRole('button', { name, exact: true }).click()
      expect((await response).status()).toBe(200)
    }
    expect(keys).toEqual(Object.values(names).map(k => [k]))
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM')
      await new Promise<void>(resolve => server.once('exit', () => resolve()))
    }
    if (core.listening) await new Promise<void>(resolve => core.close(() => resolve()))
    await rm(data, { recursive: true, force: true })
  }
})
