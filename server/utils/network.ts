// Who may talk to wherdr: this computer and the tailnet, nothing else unless
// the owner of the machine says so (WHERDR_TRUSTED_NETWORKS).
//
// The decision rests on the TCP peer of the connection (socket.remoteAddress),
// which a client cannot choose: a TCP connection only opens once the client
// has received the server's reply at the source address it claims.
// - Loopback (127.0.0.0/8, ::1): the kernel drops packets that arrive from a
//   network interface with a loopback source ("martian" packets).
// - Tailnet: an address in 100.64.0.0/10 or fd7a:115c:a1e0::/48 counts only
//   when Tailscale itself, running on this machine, lists it as one of its
//   peers or its own. Tailscale routes each peer's address into its encrypted
//   interface, so a reply to a forged peer address never goes back to the
//   Wi-Fi. An interface address in that range proves nothing (a LAN may use
//   it): Tailscale's state is read from Tailscale (CLI or its socket).
// - Docker: connections made on the host reach the container from its
//   gateway, and so do outside ones Docker's userland proxy relays (a port
//   published on every interface, on an IPv6 address, or on another host
//   port). Nothing inside the container proves which: the gateway counts as
//   this computer only when the deployment declares that the port is published
//   on the host's 127.0.0.1 only (WHERDR_DOCKER_LOOPBACK_ONLY=1, set next to
//   the `ports` line of the shipped Compose file) AND the port does not answer
//   on the gateway (which catches the most common mistake, `7683:7683`).
//   A port that answers on the gateway is published on every interface:
//   gateway connections are then refused. Without the declaration, wherdr
//   cannot prove more: it serves the gateway and warns at startup.
//
// What a peer on this machine cannot prove: a relay running here (a reverse
// proxy, a TCP forward, `tailscale funnel`) connects from loopback like a
// local browser. wherdr reads Tailscale's serve configuration: while it shows
// that Funnel exposes wherdr's port, in any form (HTTPS proxy, TCP,
// TLS-terminated TCP), every connection from this machine is refused. A
// failed or missing reading proves nothing either way: connections are
// served and the server log says Funnel cannot be checked.
// The passkey is never required by the network: it locks the app when the
// owner sets one up, wherever the device is. Any other relay the owner runs
// is indistinguishable from this computer: documented, with the passkey
// recommended as soon as the access is HTTPS.
//
// Proxy headers (X-Forwarded-For, Forwarded, X-Real-IP…) are read only when the
// peer is on this machine, and they can only refuse more: every address they
// name must be trusted too. A client that writes its own headers can only get
// itself refused (unless a relay here passes its headers on unchanged, which
// is the relay case above).
import net from 'node:net'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tailnetFacts, tailnetPeers, tailscaleBin } from '../../bin/lib/tailnet.mjs'

export type NetZone = 'local' | 'tailnet' | 'trusted' | 'open'
// peer: another network; forwarded: a proxy names a client from one;
// funnel: Tailscale Funnel exposes wherdr; docker: Docker publishes wherdr's
// port on every interface.
export type NetRefusal = 'peer' | 'forwarded' | 'funnel' | 'docker'
export type NetCheck =
  | { ok: true, zone: NetZone }
  | { ok: false, reason: NetRefusal }

export interface TrustedNetworks {
  // WHERDR_TRUSTED_NETWORKS=any: every network accepted (warned at startup and in the app).
  any: boolean
  // Extra private ranges (ZeroTier, WireGuard…), as CIDRs or single addresses.
  list: net.BlockList
  entries: string[]
  // Entries that are not an address or a CIDR (reported at startup).
  invalid: string[]
}

// Tailscale as Tailscale reports it. funnel: Funnel exposes wherdr's port;
// null: unknown (served, warned at startup).
export interface TailscaleState { running: boolean, selfIps: string[], peerIps: string[], funnel: boolean | null }

export interface NetContext {
  trusted: TrustedNetworks
  // null: nothing read yet (Funnel unknown, no tailnet peer known).
  tailscale: TailscaleState | null
  // In Docker: the container's gateway, through which the host's own
  // connections arrive…
  gateway?: string
  // …whether wherdr's port also answers on it (published on every
  // interface; null: not checked yet)…
  gatewayWide?: boolean | null
  // …and whether the deployment declares a loopback-only publication
  // (WHERDR_DOCKER_LOOPBACK_ONLY; without it, the startup log warns).
  gatewayDeclared?: boolean
}

const LOOPBACK = new net.BlockList()
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4')
LOOPBACK.addAddress('::1', 'ipv6')
const TAILNET = new net.BlockList()
TAILNET.addSubnet('100.64.0.0', 10, 'ipv4')
TAILNET.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6')

// "::ffff:1.2.3.4" (IPv4 on a dual-stack socket) → "1.2.3.4"; scope ids dropped.
export function plainIp(value: string | undefined | null): string {
  const v = String(value || '').trim().replace(/^\[|\]$/g, '').replace(/%.+$/, '').toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
  return mapped ? mapped[1]! : v
}

function family(ip: string): 'ipv4' | 'ipv6' | null {
  const f = net.isIP(ip)
  return f === 4 ? 'ipv4' : f === 6 ? 'ipv6' : null
}

const inList = (list: net.BlockList, ip: string) => {
  const f = family(ip)
  return Boolean(f && list.check(ip, f))
}
export const isLoopbackIp = (ip: string) => inList(LOOPBACK, plainIp(ip))
export const isTailnetIp = (ip: string) => inList(TAILNET, plainIp(ip))
const sameIp = (a: string, b: string) => {
  const fa = family(a)
  if (!fa || fa !== family(b)) return false
  const one = new net.BlockList()
  one.addAddress(a, fa)
  return one.check(b, fa)
}

export function parseTrustedNetworks(value = process.env.WHERDR_TRUSTED_NETWORKS || ''): TrustedNetworks {
  const out: TrustedNetworks = { any: false, list: new net.BlockList(), entries: [], invalid: [] }
  for (const raw of value.split(',').map(s => s.trim()).filter(Boolean)) {
    if (/^(any|\*)$/i.test(raw)) { out.any = true; continue }
    const [addr, bits, extra] = raw.split('/')
    const ip = plainIp(addr)
    const f = family(ip)
    const max = f === 'ipv4' ? 32 : 128
    const prefix = bits === undefined ? max : /^\d+$/.test(bits) ? Number(bits) : -1
    if (!f || extra !== undefined || prefix < 0 || prefix > max) { out.invalid.push(raw); continue }
    out.list.addSubnet(ip, prefix, f)
    out.entries.push(bits === undefined ? ip : `${ip}/${prefix}`)
  }
  return out
}

// A tailnet address Tailscale itself vouches for: one of its peers or its own.
export function tailnetKnown(ip: string, ts: TailscaleState | null): boolean {
  const a = plainIp(ip)
  if (!ts?.running || !isTailnetIp(a)) return false
  return [...ts.selfIps, ...ts.peerIps].some(x => sameIp(plainIp(x), a))
}

type Headers = Record<string, string | string[] | undefined>
const header = (h: Headers, name: string) => {
  const v = h[name]
  return Array.isArray(v) ? v.join(',') : v || ''
}

// Every client address a proxy put in the request (all hops, not only the
// last one: these headers can only refuse more).
export function forwardedClients(h: Headers): string[] {
  const out: string[] = []
  for (const part of header(h, 'x-forwarded-for').split(',')) if (part.trim()) out.push(part.trim())
  for (const element of header(h, 'forwarded').split(',')) {
    for (const pair of element.split(';')) {
      const m = /^\s*for\s*=\s*"?([^"]*)"?\s*$/i.exec(pair)
      // "[2001:db8::1]:4711" or "192.0.2.43:47011" → the address alone.
      if (m) out.push(m[1]!.replace(/^\[([^\]]+)\](:\d+)?$/, '$1').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1'))
    }
  }
  for (const name of ['x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'fly-client-ip']) {
    const v = header(h, name).trim()
    if (v) out.push(v)
  }
  return out
}

// The zone of an address a local proxy names. These only restrict (the
// connection already comes from this machine), so the tailnet range is taken
// at its word here: it can only turn "local" into "tailnet".
function forwardedZone(ip: string, ctx: NetContext): NetZone | null {
  const a = plainIp(ip)
  if (!family(a)) return ctx.trusted.any ? 'open' : null
  if (isLoopbackIp(a)) return 'local'
  if (isTailnetIp(a)) return 'tailnet'
  if (inList(ctx.trusted.list, a)) return 'trusted'
  return ctx.trusted.any ? 'open' : null
}

const RANK: Record<NetZone, number> = { local: 0, tailnet: 1, trusted: 2, open: 3 }

// The verdict for one connection: its TCP peer, then what a local proxy says.
export function checkClient(peer: string | undefined, h: Headers, ctx: NetContext): NetCheck {
  const any = ctx.trusted.any
  const p = plainIp(peer)
  if (!family(p)) return any ? { ok: true, zone: 'open' } : { ok: false, reason: 'peer' }
  let zone: NetZone = 'local'
  if (isLoopbackIp(p)) zone = 'local'
  else if (ctx.gateway && sameIp(p, ctx.gateway)) {
    // Published on every interface: Docker's proxy may relay any network.
    if (ctx.gatewayWide === true) {
      if (!any) return { ok: false, reason: 'docker' }
      zone = 'open'
    }
  } else if (tailnetKnown(p, ctx.tailscale)) return { ok: true, zone: 'tailnet' }
  else if (inList(ctx.trusted.list, p)) return { ok: true, zone: 'trusted' }
  else return any ? { ok: true, zone: 'open' } : { ok: false, reason: 'peer' }

  // From this machine: a local browser, or a relay running here. While Funnel
  // exposes wherdr's port, it may be the Internet: refused.
  if (header(h, 'tailscale-funnel-request') || ctx.tailscale?.funnel === true) {
    if (!any) return { ok: false, reason: 'funnel' }
    zone = 'open'
  }
  for (const client of forwardedClients(h)) {
    const z = forwardedZone(client, ctx)
    if (!z) return { ok: false, reason: 'forwarded' }
    if (RANK[z] > RANK[zone]) zone = z
  }
  return { ok: true, zone }
}

// ------------------------------------------------------------------ gate

export type GateVerdict = 'ok' | 'network' | 'host' | 'origin' | 'locked'
const needsUnlock = (p: string) => (p.startsWith('/api/') && !p.startsWith('/api/auth/') && p !== '/api/health') || p.startsWith('/uploads/')

// The whole guard decision for one request (server/middleware/guard.ts) or one
// WebSocket upgrade (server/utils/ws.ts), in order:
// 1. network: the provenance above (the passkey never stands in for it, and
//    no network requires it);
// 2. Host header; 3. cross-site requests (HTTP) or a foreign Origin (WS);
// 4. the passkey lock, once the owner set one up.
export function gateDecision(o: {
  check: NetCheck
  unlocked: boolean
  hostOk: boolean
  path: string
  // HTTP: Sec-Fetch-Site says another site; WS: the Origin differs from the host.
  crossSite: boolean
  ws?: boolean
}): GateVerdict {
  if (!o.check.ok) return 'network'
  if (!o.hostOk) return 'host'
  if (o.crossSite && (o.ws || o.path.startsWith('/api/'))) return 'origin'
  if ((o.ws || needsUnlock(o.path)) && !o.unlocked) return 'locked'
  return 'ok'
}

// ------------------------------------------------------------------ runtime

// Default gateway of the container (/proc/net/route: little-endian hex).
export function dockerGateway(): string {
  try {
    const row = fs.readFileSync('/proc/net/route', 'utf8').split('\n').map(l => l.trim().split(/\s+/)).find(f => f[1] === '00000000')
    const hex = row?.[2]
    return hex ? [3, 2, 1, 0].map(i => String(Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16))).join('.') : ''
  } catch { return '' }
}

// Whether something accepts TCP connections at host:port.
export function portAnswers(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: timeoutMs })
    const done = (v: boolean) => { sock.destroy(); resolve(v) }
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

const inDocker = fs.existsSync('/.dockerenv')
const TRUSTED = parseTrustedNetworks()
const PORT = Number(process.env.NITRO_PORT || process.env.PORT || 3000)
const REFRESH_MS = 10_000
// Past this age without a successful read, Tailscale's peers are not trusted.
const STALE_MS = 3 * REFRESH_MS

// The latest reading of Tailscale. A failed one replaces it too: what was true
// before is not known any more.
let ts: (TailscaleState & { at: number }) | null = null
const gateway = inDocker ? dockerGateway() : ''
const gatewayDeclared = /^(1|true|yes|on)$/i.test((process.env.WHERDR_DOCKER_LOOPBACK_ONLY || '').trim())
let gatewayWide: boolean | null = null

export type TailscaleReader = () => Promise<{ installed?: boolean, readable?: boolean, running: boolean, selfIps: string[], peerIps: string[], funnel: boolean | null }>
// In Docker every Funnel route counts, the host's port may differ from the
// container's, unless the deployment declares the shipped publication
// (127.0.0.1, same port: WHERDR_DOCKER_LOOPBACK_ONLY).
const defaultReader: TailscaleReader = () => tailnetFacts(PORT, undefined, undefined, inDocker && !gatewayDeclared)

// Called after every reading (server/utils/ws.ts closes the WebSockets the
// new state no longer allows).
const listeners = new Set<() => void>()
export function onNetworkReading(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn) }
const notify = () => { for (const fn of listeners) { try { fn() } catch { /* a listener's own problem */ } } }

// `now`: when the reading starts; it is dated from then.
export async function refreshTailscale(read: TailscaleReader = defaultReader, now = Date.now(), docker = inDocker) {
  try {
    const f = await read()
    // In Docker, no Tailscale socket does not mean no Tailscale: the host may
    // run one (with Funnel) that the container cannot see.
    const funnel = docker && f.installed === false ? null : f.funnel
    ts = { running: f.readable === false ? false : f.running, selfIps: f.selfIps, peerIps: f.peerIps, funnel, at: now }
  } catch {
    ts = { running: false, selfIps: [], peerIps: [], funnel: null, at: now }
  }
  notify()
}

// A reading started at most `maxAgeMs` ago, read now if needed (concurrent
// callers share one reading started late enough). HTTP requests accept 2 s;
// a WebSocket upgrade asks for a reading started after it arrived.
let inflight: { at: number, done: Promise<void> } | null = null
export async function ensureFresh(maxAgeMs: number, read: TailscaleReader = defaultReader, now = Date.now()) {
  if (forced) return
  if (ts && ts.at >= now - maxAgeMs) return
  if (inflight && inflight.at >= now - maxAgeMs) return inflight.done
  const at = Date.now()
  const done = refreshTailscale(read, at).finally(() => { if (inflight?.done === done) inflight = null })
  inflight = { at, done }
  return done
}

export async function refreshGateway(port = PORT) {
  if (!gateway) return
  gatewayWide = await portAnswers(gateway, port)
  notify()
}

let forced: NetContext | null = null
// Tests: a fixed context (null = the live one).
export function setNetContextForTests(ctx: NetContext | null) { forced = ctx }
// Tests: forget what was read.
export function resetNetworkStateForTests() { ts = null; gatewayWide = null; inflight = null }

export function netContext(now = Date.now()): NetContext {
  if (forced) return forced
  // Stale (no reading finished lately): nothing is known.
  const fresh = ts && now - ts.at < STALE_MS ? ts : null
  return {
    trusted: TRUSTED,
    tailscale: fresh ? { running: fresh.running, selfIps: fresh.selfIps, peerIps: fresh.peerIps, funnel: fresh.funnel } : null,
    ...(gateway ? { gateway, gatewayWide, gatewayDeclared } : {}),
  }
}
export const openNetworkMode = () => TRUSTED.any

let ready: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | null = null
let warnedWide = false
let warnedFunnel: boolean | null = null
const warn = (text: string) => console.warn(`${new Date().toISOString()} WARNING: ${text}`)
async function refreshAll() {
  await Promise.all([refreshTailscale(), refreshGateway()])
  if (gateway && gatewayWide && !warnedWide) {
    warn(`wherdr's port ${PORT} is published on every interface of this host, not only 127.0.0.1: connections through Docker's gateway may come from another network, so wherdr refuses them. Publish it as "127.0.0.1:${PORT}:${PORT}" (docker-compose.yml).`)
  }
  warnedWide = Boolean(gatewayWide)
  // Said once when it starts (and again if it changes): Funnel cannot be ruled out.
  const unknown = ts?.funnel === null
  if (unknown && warnedFunnel !== true) {
    warn(inDocker
      ? 'Tailscale\'s state cannot be read from the container: wherdr cannot check whether Tailscale Funnel exposes it to the Internet. Mount /var/run/tailscale (docker-compose.yml) so it can.'
      : 'Tailscale\'s serve configuration cannot be read: wherdr cannot check whether Tailscale Funnel exposes it to the Internet.')
  }
  warnedFunnel = unknown
}
// Started once (server/plugins/network.ts); requests wait for the first read
// so as few as possible are judged on an unknown state.
export function startNetworkWatch() {
  if (ready) return ready
  if (gateway && !gatewayDeclared) {
    warn(`WHERDR_DOCKER_LOOPBACK_ONLY is not set: wherdr cannot confirm that Docker publishes its port on the host's 127.0.0.1 only. If it does ("127.0.0.1:${PORT}:${PORT}"), set WHERDR_DOCKER_LOOPBACK_ONLY=1 next to that line, as in the shipped docker-compose.yml.`)
  }
  // A slow Tailscale: requests wait up to 15 s, then are judged on what is
  // known (nothing yet: no tailnet peer, Funnel unknown).
  ready = Promise.race([refreshAll(), new Promise<void>(r => setTimeout(r, 15_000))])
  timer = setInterval(() => { void refreshAll() }, REFRESH_MS)
  timer.unref?.()
  return ready
}
export function stopNetworkWatch() { if (timer) clearInterval(timer); timer = null }
export const networkReady = () => ready ?? Promise.resolve()

export function checkRequestClient(socketPeer: string | undefined, h: Headers): NetCheck {
  return checkClient(socketPeer, h, netContext())
}

// ------------------------------------------------------------------ listening

export type ListenVerdict = { ok: true, warn?: string } | { ok: false, message: string }

// Tailscale's own addresses, read once at startup when HOST is in a tailnet
// range, with the CLI (null without one: such a HOST is then refused).
export function tailscaleSelfSync(bin = tailscaleBin()): { running: boolean, selfIps: string[] } | null {
  if (!bin) return null
  try {
    const p = tailnetPeers(execFileSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }))
    return { running: p.running, selfIps: p.selfIps }
  } catch { return null }
}

// The address wherdr listens on (HOST), checked before it starts listening.
// In Docker the container listens on every interface of its own network and
// the host decides what is published: only the per-request check applies.
export function listenVerdict(host: string, trusted: TrustedNetworks, docker = inDocker, self: () => { running: boolean, selfIps: string[] } | null = tailscaleSelfSync): ListenVerdict {
  const h = plainIp(host || '127.0.0.1')
  const opt = 'WHERDR_TRUSTED_NETWORKS'
  const openWarn = `${opt}=any: wherdr accepts connections from ANY network, in plain HTTP. Anyone who can reach this machine can control your agents. Remove it unless the network is protected another way.`
  if (trusted.any) return { ok: true, warn: openWarn }
  if (docker) return { ok: true }
  if (h === 'localhost' || isLoopbackIp(h)) return { ok: true }
  if (isTailnetIp(h)) {
    const s = self()
    if (s?.running && s.selfIps.some(ip => sameIp(plainIp(ip), h))) return { ok: true }
  }
  const named = family(h) && (inList(trusted.list, h) || ((h === '0.0.0.0' || h === '::') && trusted.entries.length))
  if (named) {
    return { ok: true, warn: `Listening on ${h}: only this computer, the tailnet and ${trusted.entries.join(', ')} are accepted (${opt}).` }
  }
  return {
    ok: false,
    message: [
      `Refusing to listen on ${host}: wherdr would be reachable in plain HTTP by anyone on that network (a coffee shop Wi-Fi, an office LAN), and could control your agents.`,
      'Keep HOST=127.0.0.1 and reach it from your devices through Tailscale (`wherdr phone`, or Settings › Phone),',
      'or listen on this machine\'s tailnet address as Tailscale reports it (`tailscale ip`), with Tailscale running.',
      `For another private network (ZeroTier, WireGuard…), name its range: ${opt}=10.147.17.0/24 (comma-separated).`,
      `To accept any network anyway: ${opt}=any (not recommended).`,
    ].join('\n'),
  }
}

export const trustedNetworks = () => TRUSTED
