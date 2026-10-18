// Who may talk to wherdr: this computer and the tailnet, nothing else unless
// the owner of the machine says so (WHERDR_TRUSTED_NETWORKS).
//
// The decision rests on the TCP peer of the connection (socket.remoteAddress),
// which a client cannot choose: a TCP connection only opens once the client
// has received the server's reply at the source address it claims.
// - Loopback (127.0.0.0/8, ::1): the kernel drops packets that arrive from a
//   network interface with a loopback source ("martian" packets).
// - Tailnet (100.64.0.0/10, fd7a:115c:a1e0::/48): Tailscale routes these
//   ranges into its own interface, so a reply to a forged tailnet source goes
//   into the encrypted tunnel, never back to the Wi-Fi. They count only while
//   this machine has an address in that range itself (Tailscale is up), so a
//   LAN that happens to use 100.64.0.0/10 is not mistaken for the tailnet.
// - Docker: the port is published on the host's 127.0.0.1; connections made
//   on the host reach the container from its gateway. A port published on
//   every interface keeps the real source of outside clients (DNAT), which is
//   then refused like any other.
//
// Proxy headers (X-Forwarded-For, Forwarded, X-Real-IP…) are read only when the
// peer is local (a proxy on this machine, such as `tailscale serve`), and they
// can only refuse more: every address they name must be trusted too. A client
// that writes its own headers can therefore only get itself refused. This also
// refuses what a local proxy brings from the open network or the Internet
// (a reverse proxy listening on the Wi-Fi, a Cloudflare Tunnel, Tailscale
// Funnel).
import net from 'node:net'
import os from 'node:os'
import fs from 'node:fs'

export type NetZone = 'local' | 'tailnet' | 'trusted' | 'open'
export type NetRefusal = 'peer' | 'forwarded' | 'funnel'
export type NetCheck = { ok: true, zone: NetZone } | { ok: false, reason: NetRefusal }

export interface TrustedNetworks {
  // WHERDR_TRUSTED_NETWORKS=any: every network accepted (warned at startup and in the app).
  any: boolean
  // Extra private ranges (ZeroTier, WireGuard…), as CIDRs or single addresses.
  list: net.BlockList
  entries: string[]
  // Entries that are not an address or a CIDR (reported at startup).
  invalid: string[]
}

export interface NetContext {
  trusted: TrustedNetworks
  // This machine has a tailnet address (Tailscale is up), or runs in Docker
  // (the container cannot see the host's interfaces; the host routes the range).
  tailnetUp: boolean
  // In Docker: the container's gateway, through which the host's own
  // connections arrive.
  gateway?: string
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

// Where an address comes from, or null when it is not trusted.
export function addressZone(ip: string, ctx: NetContext): NetZone | null {
  const a = plainIp(ip)
  if (!family(a)) return ctx.trusted.any ? 'open' : null
  if (isLoopbackIp(a) || (ctx.gateway && a === ctx.gateway)) return 'local'
  if (ctx.tailnetUp && isTailnetIp(a)) return 'tailnet'
  if (inList(ctx.trusted.list, a)) return 'trusted'
  return ctx.trusted.any ? 'open' : null
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

// The verdict for one request: its TCP peer, then what a local proxy says.
export function checkClient(peer: string | undefined, h: Headers, ctx: NetContext): NetCheck {
  const peerZone = addressZone(peer || '', ctx)
  if (!peerZone || (!peer && !ctx.trusted.any)) return { ok: false, reason: 'peer' }
  if (peerZone !== 'local') return { ok: true, zone: peerZone }
  // Tailscale Funnel: from the Internet, through `tailscale serve`.
  if (header(h, 'tailscale-funnel-request') && !ctx.trusted.any) return { ok: false, reason: 'funnel' }
  const rank: Record<NetZone, number> = { local: 0, tailnet: 1, trusted: 2, open: 3 }
  let zone: NetZone = 'local'
  for (const client of forwardedClients(h)) {
    const z = addressZone(client, ctx)
    if (!z) return { ok: false, reason: 'forwarded' }
    if (rank[z] > rank[zone]) zone = z
  }
  return { ok: true, zone }
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

export function hasTailnetAddress(interfaces = os.networkInterfaces()): boolean {
  return Object.values(interfaces).some(list => (list || []).some(a => isTailnetIp(a.address)))
}

const inDocker = fs.existsSync('/.dockerenv')
const TRUSTED = parseTrustedNetworks()
const CTX_MS = 5000
let cached: { at: number, ctx: NetContext } | null = null
// Tailscale may come up after wherdr: the interfaces are read again every few seconds.
let forced: NetContext | null = null
// Tests: a fixed context (null = read the machine again).
export function setNetContextForTests(ctx: NetContext | null) { forced = ctx; cached = null }
export function netContext(now = Date.now()): NetContext {
  if (forced) return forced
  if (cached && now - cached.at < CTX_MS) return cached.ctx
  const ctx: NetContext = {
    trusted: TRUSTED,
    tailnetUp: inDocker || hasTailnetAddress(),
    ...(inDocker ? { gateway: dockerGateway() } : {}),
  }
  cached = { at: now, ctx }
  return ctx
}
export const openNetworkMode = () => TRUSTED.any

export function checkRequestClient(socketPeer: string | undefined, h: Headers): NetCheck {
  return checkClient(socketPeer, h, netContext())
}

// ------------------------------------------------------------------ listening

export type ListenVerdict = { ok: true, warn?: string } | { ok: false, message: string }

// The address wherdr listens on (HOST), checked before it starts listening.
// In Docker the container listens on every interface of its own network and
// the host decides what is published: only the per-request check applies.
export function listenVerdict(host: string, trusted: TrustedNetworks, docker = inDocker, interfaces = os.networkInterfaces()): ListenVerdict {
  const h = plainIp(host || '127.0.0.1')
  const opt = 'WHERDR_TRUSTED_NETWORKS'
  const openWarn = `${opt}=any: wherdr accepts connections from ANY network, in plain HTTP. Anyone who can reach this machine can control your agents. Remove it unless the network is protected another way.`
  if (trusted.any) return { ok: true, warn: openWarn }
  if (docker) return { ok: true }
  if (h === 'localhost' || isLoopbackIp(h)) return { ok: true }
  const local = Object.values(interfaces).flatMap(list => (list || []).map(a => plainIp(a.address)))
  if (isTailnetIp(h) && local.includes(h)) return { ok: true }
  const named = family(h) && (inList(trusted.list, h) || ((h === '0.0.0.0' || h === '::') && trusted.entries.length))
  if (named) {
    return { ok: true, warn: `Listening on ${h}: only this computer, the tailnet and ${trusted.entries.join(', ')} are accepted (${opt}).` }
  }
  return {
    ok: false,
    message: [
      `Refusing to listen on ${host}: wherdr would be reachable in plain HTTP by anyone on that network (a coffee shop Wi-Fi, an office LAN), and could control your agents.`,
      'Keep HOST=127.0.0.1 and reach it from your devices through Tailscale (`wherdr phone`, or Settings › Phone),',
      'or listen on this machine\'s tailnet address (100.x.y.z).',
      `For another private network (ZeroTier, WireGuard…), name its range: ${opt}=10.147.17.0/24 (comma-separated).`,
      `To accept any network anyway: ${opt}=any (not recommended).`,
    ].join('\n'),
  }
}

export const trustedNetworks = () => TRUSTED
