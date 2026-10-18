import { afterEach, describe, expect, it } from 'vitest'
import { funnelExposes, tailnetPeers } from '../bin/lib/tailnet.mjs'
import {
  checkClient, forwardedClients, fullAccess, gateDecision, isLoopbackIp, isTailnetIp, listenVerdict, netContext,
  parseTrustedNetworks, plainIp, refreshTailscale, resetNetworkStateForTests, tailnetKnown, type NetContext, type TailscaleState,
} from '../server/utils/network'

const TS: TailscaleState = { running: true, selfIps: ['100.90.1.2', 'fd7a:115c:a1e0::2'], peerIps: ['100.101.102.103', 'fd7a:115c:a1e0::5'], funnel: false }
const ctx = (over: Partial<NetContext> = {}, trusted = ''): NetContext => ({ trusted: parseTrustedNetworks(trusted), tailscale: TS, ...over })

describe('addresses', () => {
  it('normalizes IPv4-mapped and bracketed addresses', () => {
    expect(plainIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(plainIp('[::1]')).toBe('::1')
    expect(plainIp('fe80::1%eth0')).toBe('fe80::1')
  })
  it('knows loopback and the tailnet ranges', () => {
    expect(isLoopbackIp('127.8.9.10')).toBe(true)
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackIp('192.168.1.20')).toBe(false)
    expect(isTailnetIp('100.127.255.254')).toBe(true)
    expect(isTailnetIp('100.128.0.1')).toBe(false)
    expect(isTailnetIp('fd7a:115c:a1e0::1')).toBe(true)
    expect(isTailnetIp('fd7a:115c:a1e1::1')).toBe(false)
  })
})

describe('trusted networks', () => {
  it('parses CIDRs, single addresses and `any`, and reports the rest', () => {
    const t = parseTrustedNetworks(' 10.147.17.0/24, 192.168.1.5 ,fd00::/8, nope, 10.0.0.0/40 ')
    expect(t.entries).toEqual(['10.147.17.0/24', '192.168.1.5', 'fd00::/8'])
    expect(t.invalid).toEqual(['nope', '10.0.0.0/40'])
    expect(t.list.check('10.147.17.9', 'ipv4')).toBe(true)
    expect(parseTrustedNetworks('any').any).toBe(true)
  })
})

describe('tailnet: what Tailscale itself reports', () => {
  it('reads running state, own and peer addresses from `tailscale status --json`', () => {
    const json = JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.90.1.2'] }, Peer: { a: { TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::5'] } } })
    expect(tailnetPeers(json)).toEqual({ readable: true, state: 'Running', running: true, selfIps: ['100.90.1.2'], peerIps: ['100.101.102.103', 'fd7a:115c:a1e0::5'] })
    expect(tailnetPeers('{"BackendState":"Stopped"}')).toMatchObject({ readable: true, running: false })
    // A failed read is unknown, not "stopped".
    expect(tailnetPeers('')).toMatchObject({ readable: false, running: false })
    expect(tailnetPeers('not json')).toMatchObject({ readable: false })
  })
  it('trusts a tailnet peer only while Tailscale runs and lists it', () => {
    expect(tailnetKnown('100.101.102.103', TS)).toBe(true)
    expect(tailnetKnown('::ffff:100.101.102.103', TS)).toBe(true)
    expect(tailnetKnown('100.70.0.4', TS)).toBe(false)
    expect(tailnetKnown('100.101.102.103', { ...TS, running: false })).toBe(false)
    expect(tailnetKnown('100.101.102.103', null)).toBe(false)
  })
  it('never takes a CGNAT LAN for the tailnet: Tailscale absent, stopped, or not listing it', () => {
    expect(checkClient('100.101.102.103', {}, ctx())).toEqual({ ok: true, zone: 'tailnet' })
    expect(checkClient('fd7a:115c:a1e0::5', {}, ctx())).toEqual({ ok: true, zone: 'tailnet' })
    expect(checkClient('100.70.0.4', {}, ctx())).toEqual({ ok: false, reason: 'peer' })
    expect(checkClient('100.101.102.103', {}, ctx({ tailscale: null }))).toEqual({ ok: false, reason: 'peer' })
    expect(checkClient('100.101.102.103', {}, ctx({ tailscale: { ...TS, running: false } }))).toEqual({ ok: false, reason: 'peer' })
    // Docker without Tailscale's socket: no implicit trust in the range either.
    expect(checkClient('100.101.102.103', {}, ctx({ tailscale: null, gateway: '172.17.0.1', gatewayWide: false, gatewayDeclared: true }))).toEqual({ ok: false, reason: 'peer' })
  })
})

describe('tailnet state over time', () => {
  afterEach(() => resetNetworkStateForTests())
  const up = { installed: true, readable: true, running: true, selfIps: [], peerIps: ['100.101.102.103'], funnel: false }
  it('stops trusting peers once Tailscale stops, fails to answer, or its state is stale', async () => {
    const t0 = 1_000_000
    await refreshTailscale(async () => up, t0, false)
    expect(checkClient('100.101.102.103', {}, netContext(t0 + 1000)).ok).toBe(true)
    await refreshTailscale(async () => ({ ...up, running: false, peerIps: [] }), t0 + 10_000, false)
    expect(checkClient('100.101.102.103', {}, netContext(t0 + 11_000))).toEqual({ ok: false, reason: 'peer' })
    await refreshTailscale(async () => up, t0 + 20_000, false)
    await refreshTailscale(async () => { throw new Error('tailscale hangs') }, t0 + 30_000, false)
    expect(checkClient('100.101.102.103', {}, netContext(t0 + 31_000))).toEqual({ ok: false, reason: 'peer' })
    await refreshTailscale(async () => up, t0 + 40_000, false)
    expect(checkClient('100.101.102.103', {}, netContext(t0 + 80_000))).toEqual({ ok: false, reason: 'peer' })
  })
  it('counts Funnel as possible until a valid reading proves otherwise', async () => {
    const t0 = 2_000_000
    // Nothing read yet (startup): unverified.
    expect(checkClient('127.0.0.1', {}, netContext(t0))).toEqual({ ok: true, zone: 'unverified', why: 'funnel' })
    await refreshTailscale(async () => ({ ...up, funnel: true }), t0, false)
    expect(checkClient('127.0.0.1', {}, netContext(t0 + 1000))).toEqual({ ok: true, zone: 'unverified', why: 'funnel' })
    // Status unreadable: still unverified (not "stopped, so no Funnel").
    await refreshTailscale(async () => ({ ...up, readable: false, running: false, peerIps: [], funnel: null }), t0 + 10_000, false)
    expect(checkClient('127.0.0.1', {}, netContext(t0 + 11_000))).toEqual({ ok: true, zone: 'unverified', why: 'funnel' })
    await refreshTailscale(async () => { throw new Error('socket gone') }, t0 + 20_000, false)
    expect(checkClient('127.0.0.1', {}, netContext(t0 + 21_000))).toEqual({ ok: true, zone: 'unverified', why: 'funnel' })
    // A valid reading without Funnel: local again; stale: unverified again.
    await refreshTailscale(async () => up, t0 + 30_000, false)
    expect(checkClient('127.0.0.1', {}, netContext(t0 + 31_000))).toEqual({ ok: true, zone: 'local' })
    expect(checkClient('127.0.0.1', {}, netContext(t0 + 70_000))).toEqual({ ok: true, zone: 'unverified', why: 'funnel' })
  })
  it('treats a missing Tailscale socket in Docker as unknown, and no Tailscale natively as none', async () => {
    const none = { installed: false, readable: true, running: false, selfIps: [], peerIps: [], funnel: false }
    await refreshTailscale(async () => none, 3_000_000, true)
    expect(checkClient('127.0.0.1', {}, netContext(3_000_001))).toEqual({ ok: true, zone: 'unverified', why: 'funnel' })
    await refreshTailscale(async () => none, 3_000_000, false)
    expect(checkClient('127.0.0.1', {}, netContext(3_000_001))).toEqual({ ok: true, zone: 'local' })
  })
})

describe('Funnel configuration', () => {
  const host = 'box.example.ts.net'
  it('sees Funnel on wherdr’s port as HTTPS proxy, TCP forward and TLS-terminated TCP', () => {
    const web = { Web: { [`${host}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:7683' } } } }, AllowFunnel: { [`${host}:443`]: true } }
    const tcp = { TCP: { 443: { TCPForward: '127.0.0.1:7683' } }, AllowFunnel: { [`${host}:443`]: true } }
    const tls = { TCP: { 8443: { TCPForward: 'localhost:7683', TerminateTLS: host } }, AllowFunnel: { [`${host}:8443`]: true } }
    const fg = { Foreground: { x: tcp } }
    for (const c of [web, tcp, tls, fg]) expect(funnelExposes(7683, JSON.stringify(c))).toBe(true)
  })
  it('does not count Serve without Funnel, nor Funnel on another port', () => {
    const serve = { Web: { [`${host}:7683`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:7683' } } } }, TCP: { 7683: { HTTPS: true } } }
    const other = { TCP: { 443: { TCPForward: '127.0.0.1:3000' } }, AllowFunnel: { [`${host}:443`]: true } }
    expect(funnelExposes(7683, JSON.stringify(serve))).toBe(false)
    expect(funnelExposes(7683, JSON.stringify(other))).toBe(false)
    expect(funnelExposes(7683, 'garbage')).toBe(null)
  })
})

describe('client check', () => {
  it('accepts this computer and refuses the open network', () => {
    expect(checkClient('127.0.0.1', {}, ctx())).toEqual({ ok: true, zone: 'local' })
    expect(checkClient('::1', {}, ctx())).toEqual({ ok: true, zone: 'local' })
    for (const ip of ['192.168.1.20', '10.0.0.7', '203.0.113.9', '2001:db8::1', '', undefined]) {
      expect(checkClient(ip, {}, ctx())).toEqual({ ok: false, reason: 'peer' })
    }
  })
  it('cannot be widened by headers a client writes itself', () => {
    for (const h of [{ 'x-forwarded-for': '127.0.0.1' }, { forwarded: 'for=100.64.0.1' }, { 'x-real-ip': '::1' }, { host: 'localhost:7683' }]) {
      expect(checkClient('192.168.1.20', h, ctx())).toEqual({ ok: false, reason: 'peer' })
    }
  })
  it('refuses what a local proxy says comes from elsewhere', () => {
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.64.0.2' }, ctx())).toEqual({ ok: true, zone: 'tailnet' })
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.64.0.2, 203.0.113.9' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, 100.64.0.2' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { forwarded: 'for="[2001:db8::1]:4711";proto=https' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { forwarded: 'for=unknown' }, ctx())).toEqual({ ok: false, reason: 'forwarded' })
    expect(checkClient('127.0.0.1', { 'tailscale-funnel-request': '?1' }, ctx())).toEqual({ ok: false, reason: 'funnel' })
  })
  it('treats every local connection as unverified while Funnel exposes wherdr', () => {
    const f = ctx({ tailscale: { ...TS, funnel: true } })
    expect(checkClient('127.0.0.1', {}, f)).toEqual({ ok: true, zone: 'unverified', why: 'funnel' })
    expect(checkClient('127.0.0.1', { 'x-forwarded-for': '100.64.0.2' }, f)).toEqual({ ok: true, zone: 'unverified', why: 'funnel' })
    // A tailnet peer connecting directly is still the tailnet.
    expect(checkClient('100.101.102.103', {}, f)).toEqual({ ok: true, zone: 'tailnet' })
  })
  it('trusts the Docker gateway only with the declared loopback publication and a negative probe', () => {
    const gw = (gatewayWide: boolean | null, gatewayDeclared: boolean) => ctx({ gateway: '172.17.0.1', gatewayWide, gatewayDeclared })
    const unverified = { ok: true, zone: 'unverified', why: 'docker' }
    // The shipped Compose file: 127.0.0.1, same port, declared → local.
    expect(checkClient('172.17.0.1', {}, gw(false, true))).toEqual({ ok: true, zone: 'local' })
    // A negative probe alone proves nothing: IPv6-only publication ('[::]:7683:7683'),
    // a remapped host port ('7699:7683'), or an unreachable probe all look like this.
    expect(checkClient('172.17.0.1', {}, gw(false, false))).toEqual(unverified)
    // Declared, but the port answers on the gateway (published on every interface).
    expect(checkClient('172.17.0.1', {}, gw(true, true))).toEqual(unverified)
    // Not probed yet.
    expect(checkClient('172.17.0.1', {}, gw(null, true))).toEqual(unverified)
    expect(checkClient('::ffff:172.17.0.1', { 'x-forwarded-for': '100.64.0.9' }, gw(false, true))).toEqual({ ok: true, zone: 'tailnet' })
    expect(checkClient('172.17.0.5', {}, gw(false, true))).toEqual({ ok: false, reason: 'peer' })
  })
  it('accepts ranges the owner named, and everything with `any`', () => {
    expect(checkClient('10.147.17.9', {}, ctx({}, '10.147.17.0/24'))).toEqual({ ok: true, zone: 'trusted' })
    expect(checkClient('192.168.1.20', {}, ctx({}, 'any'))).toEqual({ ok: true, zone: 'open' })
    expect(checkClient('127.0.0.1', {}, ctx({ tailscale: { ...TS, funnel: true } }, 'any'))).toEqual({ ok: true, zone: 'open' })
  })
  it('collects every forwarded client', () => {
    expect(forwardedClients({ 'x-forwarded-for': 'a, b', 'forwarded': 'for=192.0.2.43:47011, for="[::1]"', 'x-real-ip': 'c' })).toEqual(['a', 'b', '192.0.2.43', '::1', 'c'])
  })
})

// passkey on/off × local/tailnet/trusted/unverified/refused × HTTP/WS, on the
// routes that matter. auth.disable itself needs an unlocked session (auth.ts).
describe('gate matrix', () => {
  const checks = {
    local: checkClient('127.0.0.1', {}, ctx()),
    tailnet: checkClient('100.101.102.103', {}, ctx()),
    trusted: checkClient('10.147.17.9', {}, ctx({}, '10.147.17.0/24')),
    unverified: checkClient('127.0.0.1', {}, ctx({ tailscale: { ...TS, funnel: true } })),
    lan: checkClient('192.168.1.20', {}, ctx()),
  } as const
  const routes = ['/api/config', '/api/phone', '/api/update', '/api/auth/disable', '/'] as const
  const decide = (zone: keyof typeof checks, path: string, passkey: boolean, unlocked: boolean, ws = false) =>
    gateDecision({ check: checks[zone], passkey, unlocked: !passkey || unlocked, hostOk: true, crossSite: false, path, ws })

  it('without a passkey: this computer, the tailnet and named ranges get in; unverified and the LAN do not', () => {
    for (const path of routes) {
      for (const z of ['local', 'tailnet', 'trusted'] as const) expect(decide(z, path, false, false)).toBe('ok')
      expect(decide('lan', path, false, false)).toBe('network')
    }
    // Unverified: only the app and the first-passkey routes (bootstrap token required there).
    for (const path of ['/api/config', '/api/phone', '/api/update', '/api/auth/disable', '/api/auth/login/options', '/uploads/x.png']) expect(decide('unverified', path, false, false)).toBe('unverified')
    for (const path of ['/', '/_nuxt/app.js', '/api/health', '/api/auth/status', '/api/auth/register/options', '/api/auth/register/verify']) expect(decide('unverified', path, false, false)).toBe('ok')
    for (const z of ['local', 'tailnet', 'trusted'] as const) expect(decide(z, '/ws', false, false, true)).toBe('ok')
    expect(decide('unverified', '/ws', false, false, true)).toBe('unverified')
    expect(decide('lan', '/ws', false, false, true)).toBe('network')
  })
  it('with a passkey: every zone but the LAN needs the unlocked session for the API and WebSockets', () => {
    for (const z of ['local', 'tailnet', 'trusted', 'unverified'] as const) {
      for (const path of ['/api/config', '/api/phone', '/api/update']) {
        expect(decide(z, path, true, false)).toBe('locked')
        expect(decide(z, path, true, true)).toBe('ok')
      }
      // The lock screen's own routes and the app shell stay reachable.
      expect(decide(z, '/api/auth/disable', true, false)).toBe('ok')
      expect(decide(z, '/', true, false)).toBe('ok')
      expect(decide(z, '/ws', true, false, true)).toBe('locked')
      expect(decide(z, '/ws', true, true, true)).toBe('ok')
    }
    expect(decide('lan', '/api/update', true, true)).toBe('network')
    expect(decide('lan', '/ws', true, true, true)).toBe('network')
  })
  it('keeps the Host, Origin and cross-site checks after the network one', () => {
    const base = { check: checks.local, passkey: false, unlocked: true, path: '/api/config' }
    expect(gateDecision({ ...base, hostOk: false, crossSite: false })).toBe('host')
    expect(gateDecision({ ...base, hostOk: true, crossSite: true })).toBe('origin')
    expect(gateDecision({ ...base, path: '/', hostOk: true, crossSite: true })).toBe('ok')
    expect(gateDecision({ ...base, path: '/ws', ws: true, hostOk: true, crossSite: true })).toBe('origin')
  })
  it('opens Settings › Phone to this computer and the tailnet, others only once unlocked', () => {
    expect(fullAccess(checks.local, false)).toBe(true)
    expect(fullAccess(checks.tailnet, false)).toBe(true)
    expect(fullAccess(checks.trusted, false)).toBe(false)
    expect(fullAccess(checks.unverified, false)).toBe(false)
    expect(fullAccess(checks.unverified, true)).toBe(true)
    expect(fullAccess(checks.lan, false)).toBe(false)
  })
})

describe('listening address', () => {
  const t = parseTrustedNetworks
  const up = () => ({ running: true, selfIps: ['100.90.1.2'] })
  it('accepts loopback, and a tailnet address only when Tailscale reports it as its own', () => {
    for (const h of ['127.0.0.1', '', 'localhost', '::1']) expect(listenVerdict(h, t(''), false, up)).toEqual({ ok: true })
    expect(listenVerdict('100.90.1.2', t(''), false, up)).toEqual({ ok: true })
    // eth0 in 100.64.0.0/10 without Tailscale, Tailscale stopped, or not its address.
    expect(listenVerdict('100.90.1.2', t(''), false, () => null).ok).toBe(false)
    expect(listenVerdict('100.90.1.2', t(''), false, () => ({ running: false, selfIps: ['100.90.1.2'] })).ok).toBe(false)
    expect(listenVerdict('100.90.1.3', t(''), false, up).ok).toBe(false)
  })
  it('refuses every interface or a LAN address unless the option says so', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.2']) {
      const v = listenVerdict(host, t(''), false, up)
      expect(!v.ok && v.message).toContain('WHERDR_TRUSTED_NETWORKS')
    }
    expect(listenVerdict('0.0.0.0', t('10.147.17.0/24'), false, up)).toMatchObject({ ok: true, warn: expect.stringContaining('10.147.17.0/24') })
    expect(listenVerdict('192.168.1.2', t('10.0.0.0/8'), false, up).ok).toBe(false)
    expect(listenVerdict('0.0.0.0', t('any'), false, up)).toMatchObject({ ok: true, warn: expect.stringContaining('ANY network') })
  })
  it('leaves Docker to the per-request check', () => {
    expect(listenVerdict('0.0.0.0', t(''), true, up)).toEqual({ ok: true })
  })
})
