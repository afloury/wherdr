// Real relays in front of an isolated server that applies wherdr's network
// decision (checkClient + gateDecision, as guard.ts and ws.ts do), over HTTP
// and WebSocket upgrades:
// - a raw TCP relay on this machine: what `tailscale funnel` does in TCP or
//   TLS-terminated TCP mode once TLS is off (no client address), or socat;
// - an HTTP proxy that adds the client's address, as `tailscale serve` does.
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkClient, gateDecision, netContext, parseTrustedNetworks, refreshTailscale, resetNetworkStateForTests, type NetContext } from '../server/utils/network'

// live: judge with the server's own state (refreshTailscale), not ctx.
const state: { ctx: NetContext, passkey: boolean, live?: boolean } = {
  ctx: { trusted: parseTrustedNetworks(''), tailscale: { running: true, selfIps: [], peerIps: [], funnel: false } },
  passkey: false,
}
const STATUS = { ok: 200, network: 403, host: 403, origin: 403, locked: 401 } as const

function decide(req: http.IncomingMessage, ws: boolean) {
  const check = checkClient(req.socket.remoteAddress, req.headers, state.live ? netContext() : state.ctx)
  // No session cookie in these tests: unlocked only when no passkey exists.
  return { check, verdict: gateDecision({ check, unlocked: !state.passkey, hostOk: true, crossSite: false, path: ws ? '/ws' : req.url!, ws }) }
}

const app = http.createServer((req, res) => {
  const { check, verdict } = decide(req, false)
  res.writeHead(STATUS[verdict], { 'content-type': 'application/json' })
  res.end(JSON.stringify({ verdict, zone: check.ok ? check.zone : null }))
})
app.on('upgrade', (req, socket) => {
  const { verdict } = decide(req, true)
  socket.end(verdict === 'ok' ? 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n' : `HTTP/1.1 ${STATUS[verdict]} Refused\r\n\r\n`)
})

// Raw TCP relay: bytes in, bytes out, nothing added.
const tcpRelay = net.createServer((c) => {
  const up = net.connect((app.address() as AddressInfo).port, '127.0.0.1')
  c.pipe(up).pipe(c)
  c.on('error', () => up.destroy())
  up.on('error', () => c.destroy())
})

// HTTP proxy adding the client's address it knows (here, a tailnet peer).
let serveClient = '100.101.102.103'
const serveProxy = http.createServer((req, res) => {
  const xff = [req.headers['x-forwarded-for'], serveClient].filter(Boolean).join(', ')
  const up = http.request({ host: '127.0.0.1', port: (app.address() as AddressInfo).port, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': xff } }, (r) => {
    res.writeHead(r.statusCode!, r.headers)
    r.pipe(res)
  })
  req.pipe(up)
})

const listen = (s: net.Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)))
let ports: { app: number, tcp: number, serve: number }
beforeAll(async () => { ports = { app: await listen(app), tcp: await listen(tcpRelay), serve: await listen(serveProxy) } })
afterAll(() => { app.close(); tcpRelay.close(); serveProxy.close() })

async function get(port: number, headers: Record<string, string> = {}, path = '/api/config') {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers })
  return { status: r.status, body: await r.json() as { verdict: string, zone: string | null } }
}
// Any 16 bytes, base64: the handshake only needs the shape.
const WS_KEY = Buffer.alloc(16, 7).toString('base64')
// The status code of a WebSocket upgrade through `port`.
function upgrade(port: number, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => {
      const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')
      s.write(`GET /ws/events HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${WS_KEY}\r\n${extra}\r\n`)
    })
    let text = ''
    s.on('data', (d) => { text += d; const m = /^HTTP\/1\.1 (\d+)/.exec(text); if (m) { s.destroy(); resolve(Number(m[1])) } })
    s.on('error', reject)
  })
}

const reset = (funnel: boolean, passkey = false) => {
  state.ctx = { trusted: parseTrustedNetworks(''), tailscale: { running: true, selfIps: [], peerIps: [], funnel } }
  state.passkey = passkey
  state.live = false
}

describe('a raw TCP relay on this machine (Funnel TCP / TLS-terminated TCP, socat)', () => {
  it('is indistinguishable from this computer while nothing says it is exposed (documented limit)', async () => {
    reset(false)
    expect(await get(ports.tcp)).toEqual({ status: 200, body: { verdict: 'ok', zone: 'local' } })
    expect(await upgrade(ports.tcp)).toBe(101)
  })

  it('is refused over HTTP and WebSocket while Funnel exposes wherdr, passkey or not', async () => {
    for (const passkey of [false, true]) {
      reset(true, passkey)
      expect(await get(ports.tcp)).toEqual({ status: 403, body: { verdict: 'network', zone: null } })
      expect(await upgrade(ports.tcp)).toBe(403)
      // This computer itself is refused too: it cannot be told from the relay.
      expect((await get(ports.app)).status).toBe(403)
      // Nothing answers, the app shell and the passkey routes included.
      for (const path of ['/', '/api/auth/status', '/api/auth/register/options']) expect((await get(ports.tcp, {}, path)).status).toBe(403)
    }
  })

  it('stays refused while Funnel exposes it and Tailscale readings then fail', async () => {
    reset(false)
    state.live = true
    const facts = { installed: true, readable: true, running: true, selfIps: [], peerIps: [] }
    try {
      await refreshTailscale(async () => ({ ...facts, funnel: true }), Date.now(), false)
      expect((await get(ports.tcp)).status).toBe(403)
      // The status command fails, then Tailscale hangs: nothing proves Funnel is gone.
      await refreshTailscale(async () => ({ ...facts, readable: false, running: false, funnel: null }), Date.now(), false)
      expect((await get(ports.tcp)).status).toBe(403)
      expect(await upgrade(ports.tcp)).toBe(403)
      await refreshTailscale(async () => { throw new Error('tailscale hangs') }, Date.now(), false)
      expect((await get(ports.tcp)).status).toBe(403)
      // A valid reading without Funnel reopens.
      await refreshTailscale(async () => ({ ...facts, funnel: false }), Date.now(), false)
      expect((await get(ports.tcp)).status).toBe(200)
    } finally { resetNetworkStateForTests(); state.live = false }
  })

  it('is served as this computer when Tailscale cannot be read (documented limit)', async () => {
    state.ctx = { trusted: parseTrustedNetworks(''), tailscale: { running: false, selfIps: [], peerIps: [], funnel: null } }
    state.passkey = false
    expect(await get(ports.tcp)).toEqual({ status: 200, body: { verdict: 'ok', zone: 'local' } })
    expect(await upgrade(ports.tcp)).toBe(101)
  })

  it('passes on headers its client wrote: an outside address refuses, a tailnet one is believed (documented limit)', async () => {
    reset(false)
    expect(await get(ports.tcp, { 'x-forwarded-for': '203.0.113.9' })).toEqual({ status: 403, body: { verdict: 'network', zone: null } })
    expect(await upgrade(ports.tcp, { 'x-forwarded-for': '203.0.113.9' })).toBe(403)
    expect(await get(ports.tcp, { 'x-forwarded-for': '100.64.0.9' })).toEqual({ status: 200, body: { verdict: 'ok', zone: 'tailnet' } })
  })
})

describe('an HTTP proxy that adds the client address (tailscale serve)', () => {
  it('lets a tailnet client in, as the tailnet', async () => {
    reset(false)
    serveClient = '100.101.102.103'
    expect(await get(ports.serve)).toEqual({ status: 200, body: { verdict: 'ok', zone: 'tailnet' } })
  })

  it('refuses a client from the Internet, even when it forges a tailnet address first', async () => {
    reset(false)
    serveClient = '198.51.100.7'
    expect(await get(ports.serve)).toEqual({ status: 403, body: { verdict: 'network', zone: null } })
    expect(await get(ports.serve, { 'x-forwarded-for': '100.64.0.9' })).toEqual({ status: 403, body: { verdict: 'network', zone: null } })
    serveClient = '100.101.102.103'
  })

  it('refuses a Funnel HTTPS request by its header', async () => {
    reset(false)
    expect((await get(ports.serve, { 'tailscale-funnel-request': '?1' })).status).toBe(403)
  })
})
