import { test, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfAuthDb, pdfSession } from './pdfAuth.mjs'
import fixture from '../fixtures/core-0.1.16.json' with { type: 'json' }

// Own isolated server: the normal e2e launcher remains on the v2 backend.
test('core terminals use the normal home and agent navigation without legacy requests', async ({ page, browserName }) => {
  const data = await mkdtemp(join(tmpdir(), 'core-preview-'))
  const socketPath = join(data, 'core.sock')
  await writeFile(join(data, 'auth.json'), JSON.stringify(pdfAuthDb))
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
  const terminals = [fixture.inventory.terminals[0],
    { address: 'host-a/t8', cwd: '/workspace/delta', state: 'live', agent: 'custom-worker', status: { state: 'working' } },
    { address: 'host-a/t9', cwd: '/workspace/beta', state: 'live', template: 'codex', status: { state: 'idle' } },
    { address: 'host-a/ta', cwd: '/workspace/beta', state: 'live', status: { state: 'working' } },
    { address: 'host-a/tb', cwd: '/workspace/gamma', state: 'live' },
    { address: 'host-a/tc', cwd: '/workspace/epsilon', state: 'live', template: 'claude' },
    { address: 'host-a/td', cwd: '/workspace/alpha', state: 'live', template: 'codex', status: { state: 'idle' } },
  ]
  const rpc: { method: string; params: any }[] = []
  // Framed traffic of the terminal relay: [channel u32][kind u8][len u32][payload].
  const streamed: { channel: number, kind: number, payload: Buffer }[] = []
  const frame = (channel: number, kind: number, payload: Buffer) => {
    const head = Buffer.alloc(9)
    head.writeUInt32LE(channel, 0)
    head.writeUInt8(kind, 4)
    head.writeUInt32LE(payload.length, 5)
    return Buffer.concat([head, payload])
  }
  const core = createServer(socket => socket.once('data', data => {
    const r = JSON.parse(data.toString().split('\n')[0]!)
    rpc.push(r)
    if (r.method === 'hello' && r.params?.framed) {
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: { ...fixture.hello, framed: true } }) + '\n')
      let buf = Buffer.alloc(0)
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        while (buf.length >= 9 && buf.length >= 9 + buf.readUInt32LE(5)) {
          const f = { channel: buf.readUInt32LE(0), kind: buf.readUInt8(4), payload: buf.subarray(9, 9 + buf.readUInt32LE(5)) }
          buf = buf.subarray(9 + f.payload.length)
          if (f.channel) { streamed.push(f); continue }
          const call = JSON.parse(f.payload.toString())
          rpc.push(call)
          const result = call.method === 'events.subscribe' ? { channel: 2, seq: 1, terminals: [{ ...fixture.inventory.terminals[0], cols: 80, rows: 24 }] } : { channel: 3 }
          socket.write(frame(0, 0, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }))))
          if (call.method === 'terminal.attach') socket.write(frame(3, 0, Buffer.from('hello from core\r\n')))
        }
      })
      return
    }
    const result = r.method === 'hello' ? fixture.hello
      : r.method === 'terminal.list' ? { ...fixture.inventory, terminals }
      : r.method === 'machine.list' ? { machines: [{ name: 'host-a', state: 'connected' }] }
      : r.method === 'terminal.send' ? { started: true, turn: 0 }
      : r.method === 'terminal.interrupt' ? { outcome: 'stopped', key: 'esc' } : fixture.discover
    // The agent works after a message, until it is interrupted.
    if (r.method === 'terminal.send') terminals[0] = { ...terminals[0]!, status: { state: 'working' } }
    if (r.method === 'terminal.interrupt') terminals[0] = { ...terminals[0]!, status: { state: 'idle' } }
    socket.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n')
  }))
  const requests: string[] = []
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) requests.push(new URL(r.url()).pathname) })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/api/health`)).ok } catch { return false } }).toBe(true)
    await page.context().addCookies([{ name: 'hw_session', value: pdfSession(), url: `http://localhost:${port}` }])
    await page.goto(`http://localhost:${port}`)
    await new Promise<void>(resolve => core.listen(socketPath, resolve))
    await expect(page.locator('.card').filter({ hasText: 'demo' }).first()).toBeVisible()
    await expect(page.locator('.agent-group.working .card.working')).toHaveCount(2)
    await expect(page.locator('.agent-group.unknown .card.unknown')).toHaveCount(3)
    await expect(page.locator('.agent-group.ready .card')).toHaveCount(1)
    await expect(page.locator('.stat.working')).toContainText('2')
    await expect(page.locator('.stat.done')).toContainText('1')
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveCount(0)
    await page.locator('.card').filter({ hasText: 'demo' }).first().click()
    await expect(page).toHaveURL(/#\/(a|t)\//)
    await expect(page.locator('.agent-top')).toBeVisible()
    // Live terminal: output is credited back once xterm wrote it; typing takes control (resize, then keys).
    await expect.poll(() => streamed.some(f => f.channel === 3 && f.kind === 1)).toBe(true)
    expect(rpc.find(r => r.method === 'terminal.attach')?.params).toMatchObject({ terminal: fixture.inventory.terminals[0]!.address, cols: 80, rows: 24 })
    expect(streamed.some(f => f.kind === 3)).toBe(false)
    await page.locator('.xterm-helper-textarea').focus()
    await page.keyboard.type('ls')
    await expect.poll(() => streamed.filter(f => f.kind === 0).map(f => f.payload.toString()).join('')).toBe('ls')
    expect(streamed.findIndex(f => f.kind === 3)).toBeLessThan(streamed.findIndex(f => f.kind === 0))
    const field = page.getByPlaceholder(/(Message to|Command)/)
    await field.fill('run the tests')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => rpc.find(r => r.method === 'terminal.send')?.params).toEqual({ terminal: fixture.inventory.terminals[0]!.address, text: 'run the tests' })
    // Shortcuts are off in core mode: Escape in the empty composer still stops the working agent.
    await expect(page.getByRole('button', { name: 'Stop the agent' })).toBeVisible()
    await field.press('Escape')
    await expect.poll(() => rpc.find(r => r.method === 'terminal.interrupt')?.params).toMatchObject({ terminal: fixture.inventory.terminals[0]!.address })
    await expect(page.getByRole('button', { name: 'Stop the agent' })).toHaveCount(0)
    expect(rpc.some(r => r.method === 'terminal.list')).toBe(true)
    expect(rpc.some(r => r.method === 'machine.list')).toBe(true)
    // The protocol journey also runs on WebKit; virtual passkeys use Chromium CDP.
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('WebAuthn.enable')
      await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
        hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
      await page.evaluate(async () => {
        const post = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const opts = await (await post('/api/auth/register/options', {})).json()
        const credential = await navigator.credentials.create({ publicKey: (PublicKeyCredential as any).parseCreationOptionsFromJSON(opts) })
        const response = await post('/api/auth/register/verify', { response: (credential as any).toJSON(), name: 'Test passkey' })
        if (!response.ok) throw new Error('Test passkey registration failed')
      })
      await page.context().clearCookies()
      await page.reload()
      await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible()
      await page.setViewportSize({ width: 390, height: 844 })
      await page.screenshot({ path: '.shots/core-locked-phone.png' })
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.screenshot({ path: '.shots/core-locked-desktop.png' })
      await page.getByRole('button', { name: 'Unlock', exact: true }).click()
      await expect(page.locator('.agent-top')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Unlock', exact: true })).toHaveCount(0)
    }
    await page.goto(`http://localhost:${port}/#/settings`)
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByText('Plugins', { exact: true })).toHaveCount(0)
    await page.goto(`http://localhost:${port}`)
    await expect(page.locator('.agent-group.working .card')).toHaveCount(2)
    await new Promise<void>(resolve => core.close(() => resolve()))
    await expect(page.locator('.notice')).toContainText('Run hc server start for the configured core session.')
    expect(requests.filter(p => !['/api/config', '/api/chat', '/api/settings', '/api/prompt', '/api/input', '/api/interrupt'].includes(p) && !p.startsWith('/api/auth/'))).toEqual([])
  } finally {
    if (server.exitCode === null) {
      server.kill('SIGTERM')
      await new Promise<void>(resolve => server.once('exit', () => resolve()))
    }
    if (core.listening) await new Promise<void>(resolve => core.close(() => resolve()))
    await rm(data, { recursive: true, force: true })
  }
})
