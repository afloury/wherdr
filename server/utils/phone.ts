// The phone address: wherdr published on the tailnet by `tailscale serve`
// (private to your devices). wherdr adopts it by itself (adoptServed: allowed
// host and APP_URL, at startup, every TAILNET_REFRESH_MS and when an unknown
// host knocks), and Settings › Phone publishes it, checks that it answers and
// draws its QR code. Native mode runs the tailscale CLI; a container (Docker)
// reads Tailscale's socket, mounted by docker-compose.yml, and the user runs
// the publish command on the host. Without that socket, the address is typed
// (or sent by the installer) and checked through Tailscale's DNS.
import fs from 'node:fs'
import type { H3Event } from 'h3'
import { getRequestHeaders } from 'h3'
import { inspect, probe, publishArgs, publishCommand, runTailscale, serveError, tailnetDomain, tailnetUrl, tailscaleBin, tailscaledSocket, unpublishArgs } from '../../bin/lib/tailnet.mjs'
import { phoneReach } from '../../shared/phone'
import { qrSvg } from '../../shared/qr'
import type { PhoneError, PhoneResult, PhoneStatus } from '../../shared/phone'
import { APP_URL_FILE, BOOT_APP_URL, DATA_DIR, ENV_APP_URL, IN_DOCKER, TAILNET_REFRESH_MS, log } from './env'
import { setServedHosts } from './hosts'
import { auth, reqOf } from './http'
import { initVapid } from './push'

const PORT = String(process.env.NITRO_PORT || process.env.PORT || 3000)
const LOOPBACK: Record<string, true> = { 'localhost': true, '127.0.0.1': true, '::1': true }

// These routes run commands and change settings: only for this computer
// (localhost, not through a proxy such as `tailscale serve`) or a session
// already unlocked with a passkey.
export function phoneAccess(event: H3Event): boolean {
  const req = reqOf(event)
  const lock = auth.status(req)
  if (lock.enabled && lock.unlocked) return true
  const headers = getRequestHeaders(event)
  let host = ''
  try { host = new URL(`http://${headers.host || ''}`).hostname.replace(/^\[|\]$/g, '').toLowerCase() } catch { return false }
  const proxied = Object.keys(headers).some(k => k === 'x-forwarded-for' || k === 'forwarded' || k.startsWith('tailscale-'))
  const peer = (event.node.req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  // Docker publishes the port on the host's 127.0.0.1 only, through its proxy:
  // the peer is then the container's gateway.
  const localPeer = /^127\./.test(peer) || peer === '::1' || (IN_DOCKER && peer === dockerGateway())
  return Boolean(LOOPBACK[host]) && !proxied && localPeer
}

// Default gateway of the container (/proc/net/route: little-endian hex).
function dockerGateway(): string {
  try {
    const row = fs.readFileSync('/proc/net/route', 'utf8').split('\n').map(l => l.trim().split(/\s+/)).find(f => f[1] === '00000000')
    const hex = row?.[2]
    return hex ? [3, 2, 1, 0].map(i => String(Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16))).join('.') : ''
  } catch { return '' }
}

// The saved address was adopted from `tailscale serve` (applyServed), which
// then also takes it back; one typed by hand stays until it is replaced.
let adopted = (() => {
  try { return JSON.parse(fs.readFileSync(APP_URL_FILE, 'utf8'))?.source === 'serve' } catch { return false }
})()

// APP_URL becomes the phone address: saved in the data folder (read at
// startup, env.ts), used at once for allowed hosts and Web Push.
function saveAppUrl(url: string, fromServe = false) {
  if (process.env.APP_URL === url && (adopted || !fromServe)) return
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(APP_URL_FILE, `${JSON.stringify(fromServe ? { url, source: 'serve' } : { url }, null, 2)}\n`)
  adopted = fromServe
  if (process.env.APP_URL === url) return
  process.env.APP_URL = url
  initVapid()
  log(`APP_URL set to the phone address ${url}`)
}

// The adopted address is gone from `tailscale serve`: forgotten, APP_URL is
// the environment's again.
function forgetAppUrl() {
  fs.rmSync(APP_URL_FILE, { force: true })
  const was = process.env.APP_URL
  if (BOOT_APP_URL) process.env.APP_URL = BOOT_APP_URL
  else delete process.env.APP_URL
  initVapid()
  log(`phone address ${was} is no longer published by tailscale serve: forgotten`)
}

// What `tailscale serve` publishes for wherdr's port becomes what wherdr
// answers on: its hosts are allowed, and APP_URL follows unless the
// environment sets one. An address no longer published is refused again and
// forgotten. `served` null (Tailscale could not be read): nothing changes.
export function applyServed(served: string[] | null | undefined) {
  if (!served) return
  setServedHosts(served)
  if (ENV_APP_URL) return
  const current = process.env.APP_URL || ''
  if (served.length) saveAppUrl(served.includes(current) ? current : served[0]!, true)
  else if (adopted) {
    if (current !== BOOT_APP_URL) forgetAppUrl()
    adopted = false
  }
}

// Reads Tailscale and applies it (applyServed). `maxAgeMs`: skipped when the
// last reading is that recent; concurrent callers share one reading.
let adoptedAt = 0
let adopting: Promise<void> | null = null
export function adoptServed(maxAgeMs = 0): Promise<void> {
  if (adopting) return adopting
  if (maxAgeMs && Date.now() - adoptedAt < maxAgeMs) return Promise.resolve()
  const bin = tailscaleBin()
  adopting = inspect(PORT, bin, bin ? null : tailscaledSocket())
    .then((net) => { applyServed(net.served) }, (e) => { log(`tailscale serve could not be read: ${e?.message || e}`) })
    .finally(() => { adoptedAt = Date.now(); adopting = null })
  return adopting
}

let watch: ReturnType<typeof setInterval> | null = null
export function startTailnetWatch() {
  void adoptServed()
  watch = setInterval(() => { void adoptServed() }, TAILNET_REFRESH_MS)
}
export function stopTailnetWatch() {
  if (watch) clearInterval(watch)
  watch = null
}

// Docker: the address the user typed (not saved until it answers), for a
// container without Tailscale's socket or a port published another way.
let typed = ''
// When the wait for each address started (first check, or publishing):
// transient failures before PHONE_GRACE_MS are shown as 'pending'.
const waitSince = new Map<string, number>()

export async function phoneStatus(): Promise<PhoneStatus> {
  const bin = tailscaleBin()
  const socket = bin ? null : tailscaledSocket()
  const out: PhoneStatus = {
    mode: bin ? 'native' : IN_DOCKER ? 'docker' : 'missing',
    platform: process.platform, port: PORT, connected: false, https: false, url: null, served: false, funnel: false, taken: false, suggested: null,
    command: publishCommand(PORT), reach: null, reachCause: null, reachStatus: null, checkedAt: null, appUrl: '', appUrlFromEnv: Boolean(ENV_APP_URL), qr: null,
  }
  if (bin || socket) {
    const net = await inspect(PORT, bin, socket)
    applyServed(net.served)
    out.connected = Boolean(net.connected && net.name)
    out.https = Boolean(net.https)
    out.served = Boolean(net.phone?.served)
    out.funnel = Boolean(net.phone?.funnel)
    out.taken = Boolean(net.taken)
    out.suggested = net.phone?.url ?? null
    out.url = out.served ? net.phone!.url : null
  }
  if (out.mode === 'docker') {
    if (!out.suggested) {
      let resolv = ''
      try { resolv = fs.readFileSync('/etc/resolv.conf', 'utf8') } catch { /* no DNS settings */ }
      const domain = tailnetDomain(resolv)
      // HOST_LABEL when it is set: the container's own host name is not the machine's.
      const machine = (process.env.HOST_LABEL || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
      out.suggested = domain && machine ? `https://${machine}.${domain}:${PORT}/` : null
    }
    // Nothing found in Tailscale (not readable, or published another way):
    // the address typed by hand, or the one saved earlier.
    if (!out.url) out.url = typed || tailnetUrl(process.env.APP_URL)
    // An address on another HTTPS port (already published that way): the
    // command shows that port, still pointing at wherdr's own.
    const httpsPort = httpsPortOf(out.url || out.suggested)
    if (httpsPort) out.command = publishCommand(PORT, httpsPort)
  }
  if (out.url) {
    let p = await probe(out.url, 5000)
    // Typed by hand and it answers: APP_URL follows, unless the environment
    // sets another one. (A published address was adopted above, or is refused: funnel.)
    if (!out.served && (p.reach === 'ok' || p.reach === 'host') && !ENV_APP_URL) {
      saveAppUrl(out.url)
      if (p.reach === 'host') p = await probe(out.url, 5000)
    }
    const since = waitSince.get(out.url) ?? Date.now()
    if (p.reach === 'ok') waitSince.delete(out.url)
    else waitSince.set(out.url, since)
    out.reach = phoneReach(p, since)
    out.reachCause = p.cause ?? null
    out.reachStatus = p.status ?? null
    out.checkedAt = Date.now()
  }
  out.appUrl = process.env.APP_URL || ''
  if (out.reach === 'ok' && out.url) out.qr = qrSvg(out.url)
  return out
}

// The explicit port of an https:// address ('' when it is 443).
export function httpsPortOf(url: string | null): string {
  try { return url ? new URL(url).port : '' } catch { return '' }
}

const fail = async (error: PhoneError, more: { link?: string, detail?: string } = {}): Promise<PhoneResult> =>
  ({ ok: false, error, ...more, status: await phoneStatus() })

// POST /api/phone: { action: 'publish' | 'unpublish' } (native) or
// { action: 'address', url } (docker: the address `tailscale serve` printed).
export async function phoneAction(body: { action?: unknown, url?: unknown }): Promise<PhoneResult> {
  if (body.action === 'address') {
    const url = tailnetUrl(body.url)
    if (!url) return fail('address')
    typed = url
    return { ok: true, status: await phoneStatus() }
  }
  if (body.action !== 'publish' && body.action !== 'unpublish') return fail('failed', { detail: 'Unknown action' })
  const bin = tailscaleBin()
  if (!bin) return fail('offline', { link: 'https://tailscale.com/download' })
  const net = await inspect(PORT, bin)
  if (!net.connected || !net.phone) return fail('offline', { link: 'https://tailscale.com/download' })
  let args: string[]
  if (body.action === 'publish') {
    if (net.phone.served) return { ok: true, status: await phoneStatus() }
    if (net.taken) return fail('taken')
    args = publishArgs(PORT)
  } else {
    if (!net.phone.served) return { ok: true, status: await phoneStatus() }
    args = unpublishArgs(net.phone.httpsPort)
  }
  const r = await runTailscale(bin, args)
  // A fresh publication: its certificate wait starts now.
  waitSince.clear()
  log(`tailscale ${args.join(' ')} → ${r.code}`)
  if (r.code !== 0) {
    const known = serveError(r.output)
    return fail(known?.code ?? 'failed', { link: known?.link, detail: r.output.trim().slice(-600) })
  }
  return { ok: true, status: await phoneStatus() }
}
