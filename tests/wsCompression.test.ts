import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import crossws from 'crossws/adapters/node'
import WebSocket from 'ws'
import { applyWsCompression, compressionAllowed, eventSendOptions, EVENTS_DEFLATE } from '../server/utils/wsCompression'

describe('compressionAllowed', () => {
  it.each(['/ws/events', '/ws/events?x=1', '/ws/events/'])('allows %s', u => expect(compressionAllowed(u)).toBe(true))
  it.each(['/ws/term?pane=p1', '/ws/other', '/ws', '/', undefined])('refuses %s', u => expect(compressionAllowed(u)).toBe(false))
})

const servers: http.Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(r => { s.closeAllConnections(); s.close(r) })))
})

// The same wiring as the node-server preset: crossws' adapter given the h3
// websocket options, after the plugin has applied the compression settings.
async function serve(payload: string) {
  // Sent as server/routes/ws/events.ts does, a moment after the handshake so
  // the two are counted apart.
  const options = applyWsCompression({ hooks: { open: (peer: { send: (d: string, o?: { compress?: boolean }) => void }) => { setTimeout(() => peer.send(payload, eventSendOptions(payload)), 30) } } })
  const { handleUpgrade } = crossws(options as Parameters<typeof crossws>[0])
  const server = http.createServer()
  server.on('upgrade', handleUpgrade)
  servers.push(server)
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
}

// Bytes read for the first message, handshake excluded.
function firstMessage(url: string) {
  return new Promise<{ extensions: string, data: string, wire: number }>((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: true })
    let extensions = ''
    let handshake = 0
    ws.on('upgrade', (res) => {
      extensions = String(res.headers['sec-websocket-extensions'] || '')
      handshake = res.socket.bytesRead
    })
    ws.on('message', (d) => {
      // `ws` reads the whole frame before emitting it.
      const wire = (ws as unknown as { _socket: { bytesRead: number } })._socket.bytesRead - handshake
      ws.close()
      resolve({ extensions, data: d.toString(), wire })
    })
    ws.on('error', reject)
  })
}

// A state-shaped frame: repetitive JSON, like the real one.
const state = JSON.stringify({ ok: true, panes: Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, agent: 'claude', status: 'idle', label: `pane ${i}`, workspace: 'w1' })) })

describe('permessage-deflate', () => {
  it('compresses a state frame on /ws/events', async () => {
    const base = await serve(state)
    const m = await firstMessage(`${base}/ws/events`)
    expect(m.extensions).toContain('permessage-deflate')
    expect(m.data).toBe(state)
    expect(m.wire).toBeLessThan(state.length / 4)
  })

  it('compresses a repeated state frame against the previous one', async () => {
    const send = (peer: { send: (d: string, o?: { compress?: boolean }) => void }, d: string) => peer.send(d, eventSendOptions(d))
    const next = state.replace('"status":"idle"', '"status":"working"')
    const options = applyWsCompression({ hooks: { open: (peer: { send: (d: string, o?: { compress?: boolean }) => void }) => {
      setTimeout(() => send(peer, state), 30)
      setTimeout(() => send(peer, next), 60)
    } } })
    const { handleUpgrade } = crossws(options as Parameters<typeof crossws>[0])
    const server = http.createServer()
    server.on('upgrade', handleUpgrade)
    servers.push(server)
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws/events`, { perMessageDeflate: true })
    const reads: number[] = []
    const got: string[] = []
    await new Promise<void>((resolve) => {
      ws.on('message', (d) => {
        reads.push((ws as unknown as { _socket: { bytesRead: number } })._socket.bytesRead)
        got.push(d.toString())
        if (got.length === 2) { ws.close(); resolve() }
      })
    })
    expect(got).toEqual([state, next])
    expect(reads[1]! - reads[0]!).toBeLessThan(200)
  })

  it('sends frames under the threshold as they are', async () => {
    const small = JSON.stringify({ type: 'pong', pad: 'x'.repeat(EVENTS_DEFLATE.threshold - 40) })
    const base = await serve(small)
    const m = await firstMessage(`${base}/ws/events`)
    expect(m.extensions).toContain('permessage-deflate')
    expect(m.wire).toBeGreaterThanOrEqual(small.length)
  })

  it('leaves the terminal socket uncompressed', async () => {
    const base = await serve(state)
    const m = await firstMessage(`${base}/ws/term?pane=p1&cols=80&rows=24`)
    expect(m.extensions).toBe('')
    expect(m.data).toBe(state)
    expect(m.wire).toBeGreaterThanOrEqual(state.length)
  })

  it('keeps a route upgrade hook working', async () => {
    const options = applyWsCompression({ hooks: { upgrade: () => new Response(null, { status: 403 }) } })
    const { handleUpgrade } = crossws(options as Parameters<typeof crossws>[0])
    const server = http.createServer()
    server.on('upgrade', handleUpgrade)
    servers.push(server)
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws/events`)
    const status = await new Promise(r => ws.on('unexpected-response', (_req, res) => r(res.statusCode)))
    expect(status).toBe(403)
  })
})
