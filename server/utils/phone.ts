// Settings › Phone: publish wherdr on the tailnet (`tailscale serve`, private
// to your devices), check that the phone address answers, set APP_URL to it,
// and draw its QR code once it does. Native mode runs the tailscale CLI; in a
// container (Docker) the user runs the command on the host and wherdr checks
// the address through Tailscale's DNS.
import fs from 'node:fs'
import type { H3Event } from 'h3'
import { getRequestHeaders } from 'h3'
import QRCode from 'qrcode-terminal/vendor/QRCode/index.js'
import QRErrorCorrectLevel from 'qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js'
import { inspect, publishArgs, publishCommand, reachable, runTailscale, serveError, tailnetDomain, tailnetUrl, tailscaleBin, unpublishArgs } from '../../bin/lib/tailnet.mjs'
import type { PhoneError, PhoneResult, PhoneStatus } from '../../shared/phone'
import { APP_URL_FILE, DATA_DIR, ENV_APP_URL, HOST_LABEL, IN_DOCKER, log } from './env'
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

// QR code as one SVG path: 1 unit per module, quiet zone of 2.
export function qrSvg(text: string): { size: number, path: string } {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M)
  qr.addData(text)
  qr.make()
  const n: number = qr.getModuleCount()
  let d = ''
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) if (qr.isDark(r, col)) d += `M${col + 2} ${r + 2}h1v1h-1z`
  }
  return { size: n + 4, path: d }
}

// APP_URL becomes the phone address: saved in the data folder (read at
// startup, env.ts), used at once for allowed hosts and Web Push.
function saveAppUrl(url: string) {
  if (process.env.APP_URL === url) return
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(APP_URL_FILE, `${JSON.stringify({ url }, null, 2)}\n`)
  process.env.APP_URL = url
  initVapid()
  log(`APP_URL set to the phone address ${url}`)
}

// Docker: the address the user typed (not saved until it answers).
let typed = ''

export async function phoneStatus(): Promise<PhoneStatus> {
  const bin = tailscaleBin()
  const out: PhoneStatus = {
    mode: bin ? 'native' : IN_DOCKER ? 'docker' : 'missing',
    platform: process.platform, port: PORT, connected: false, https: false, url: null, served: false, taken: false, suggested: null,
    command: publishCommand(PORT), reach: null, appUrl: '', appUrlFromEnv: Boolean(ENV_APP_URL), qr: null,
  }
  if (bin) {
    const net = await inspect(PORT, bin)
    out.connected = Boolean(net.connected && net.name)
    out.https = Boolean(net.https)
    out.served = Boolean(net.phone?.served)
    out.taken = Boolean(net.taken)
    out.suggested = net.phone?.url ?? null
    out.url = out.served ? net.phone!.url : null
  } else if (IN_DOCKER) {
    let resolv = ''
    try { resolv = fs.readFileSync('/etc/resolv.conf', 'utf8') } catch { /* no DNS settings */ }
    const domain = tailnetDomain(resolv)
    const machine = HOST_LABEL.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    out.suggested = domain && machine ? `https://${machine}.${domain}:${PORT}/` : null
    out.url = typed || tailnetUrl(process.env.APP_URL)
  }
  if (out.url) {
    out.reach = await reachable(out.url, 5000)
    // It answers: APP_URL follows, unless the environment sets another one.
    if ((out.reach === 'ok' || out.reach === 'host') && !ENV_APP_URL) {
      saveAppUrl(out.url)
      if (out.reach === 'host') out.reach = await reachable(out.url, 5000)
    }
  }
  out.appUrl = process.env.APP_URL || ''
  if (out.reach === 'ok' && out.url) out.qr = qrSvg(out.url)
  return out
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
  log(`tailscale ${args.join(' ')} → ${r.code}`)
  if (r.code !== 0) {
    const known = serveError(r.output)
    return fail(known?.code ?? 'failed', { link: known?.link, detail: r.output.trim().slice(-600) })
  }
  return { ok: true, status: await phoneStatus() }
}
