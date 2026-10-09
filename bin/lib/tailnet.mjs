// The phone address: wherdr published on the tailnet by `tailscale serve`
// (private, only your devices). Reads Tailscale's state, publishes and
// unpublishes wherdr's port, and checks that the address really answers.
// Used by the server (Settings › Phone, server/utils/phone.ts) and by
// `wherdr phone` / `wherdr panel`. No dependency on the rest of bin/lib nor
// on packages: the server bundles this file.
import { execFile } from 'node:child_process'
import dns from 'node:dns'
import { existsSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export const LINKS = {
  download: 'https://tailscale.com/download',
  https: 'https://login.tailscale.com/admin/dns',
  operator: 'https://tailscale.com/kb/1242/tailscale-serve',
}

// The tailscale CLI: the macOS app's binary, Homebrew, system folders, then the PATH.
export function tailscaleBin(env = process.env, exists = existsSync) {
  const dirs = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale', '/usr/bin/tailscale']
  for (const dir of (env.PATH || '').split(path.delimiter)) if (dir) dirs.push(path.join(dir, 'tailscale'))
  return dirs.find(p => exists(p)) || null
}

// Tailscale's own socket on Linux. Its local API answers the same JSON as the
// CLI: a Docker container has no `tailscale` command, but docker-compose.yml
// mounts this folder, so wherdr reads the state there. Reading needs no
// rights; changing anything does, and wherdr never tries through the socket.
export const TAILSCALED_SOCKET = '/var/run/tailscale/tailscaled.sock'
export function tailscaledSocket(env = process.env, exists = existsSync) {
  const file = env.WHERDR_TAILSCALED_SOCKET || TAILSCALED_SOCKET
  return exists(file) ? file : null
}

// GET on Tailscale's local API → the body, '' on any failure.
function localApi(socketPath, route, timeoutMs = 4000) {
  const { promise, resolve } = Promise.withResolvers()
  const req = http.get({ socketPath, path: `/localapi/v0/${route}`, headers: { host: 'local-tailscaled.sock' }, timeout: timeoutMs }, (res) => {
    let text = ''
    res.setEncoding('utf8')
    res.on('data', (c) => { if (text.length < 1 << 20) text += c })
    res.on('end', () => resolve(res.statusCode === 200 ? text : ''))
    res.on('error', () => resolve(''))
  })
  req.on('timeout', () => req.destroy())
  req.on('error', () => resolve(''))
  return promise
}

// `tailscale status --json` → { name, connected, https }: this machine's
// tailnet name (machine.tailnet.ts.net) or null, whether Tailscale is up,
// and whether the tailnet issues HTTPS certificates.
export function tailnetStatus(statusJson) {
  let s = null
  try { s = JSON.parse(statusJson) } catch {}
  const dns = s?.Self?.DNSName
  return {
    name: typeof dns === 'string' && dns ? dns.replace(/\.$/, '') : null,
    connected: s?.BackendState === 'Running',
    https: Array.isArray(s?.CertDomains) && s.CertDomains.length > 0,
  }
}

// The HTTPS entries of a serve configuration that proxy to wherdr's local
// port on this machine's own name: [{ hostPort, httpsPort, funnel }], or null
// when the configuration could not be read (Tailscale stopped, not JSON).
// Background entries (`--bg`) and those of a `tailscale serve` still running
// in a terminal (Foreground) both count. `funnel`: also open to the Internet.
function wherdrEntries(name, port, serveJson) {
  let config = null
  try { config = JSON.parse(serveJson) } catch {}
  if (!name || !config || typeof config !== 'object' || Array.isArray(config)) return null
  const target = new RegExp(`^(https?://)?(127\\.0\\.0\\.1|localhost):${port}/?$`)
  const out = []
  for (const part of [config, ...Object.values(config.Foreground || {})]) {
    for (const [hostPort, entry] of Object.entries(part?.Web || {})) {
      const colon = hostPort.lastIndexOf(':')
      if (hostPort.slice(0, colon).toLowerCase() !== name.toLowerCase()) continue
      if (!Object.values(entry?.Handlers || {}).some(h => target.test(h?.Proxy || ''))) continue
      out.push({ hostPort, httpsPort: hostPort.slice(colon + 1), funnel: Boolean(part.AllowFunnel?.[hostPort]) })
    }
  }
  return out
}

const addressOf = (name, httpsPort) => `https://${name}${httpsPort === '443' ? '' : `:${httpsPort}`}/`

// Phone address: the `tailscale serve` entry whose proxy targets wherdr's
// local port (served on any HTTPS port), else the address publishing would
// give (same port) with served: false. Null without a tailnet name.
export function phoneAddress(name, port, serveJson) {
  if (!name) return null
  const entries = wherdrEntries(name, port, serveJson) || []
  const hit = entries.find(e => !e.funnel) || entries[0]
  if (hit) return { url: addressOf(name, hit.httpsPort), served: true, httpsPort: hit.httpsPort, ...(hit.funnel ? { funnel: true } : {}) }
  return { url: `https://${name}:${port}/`, served: false, httpsPort: String(port) }
}

// The addresses wherdr adopts by itself (server/utils/phone.ts): what
// `tailscale serve` publishes for its port on this machine's name, read from
// Tailscale, which only the owner of the machine configures. null: unknown
// (nothing is changed then); []: nothing is published. An address that
// `tailscale funnel` also opens to the Internet is never adopted.
export function servedAddresses(name, port, serveJson) {
  const entries = wherdrEntries(name, port, serveJson)
  return entries && entries.filter(e => !e.funnel).map(e => addressOf(name, e.httpsPort))
}

// HTTPS ports already published by `tailscale serve` (for anything).
export function servedPorts(serveJson) {
  try {
    const web = JSON.parse(serveJson || '{}')?.Web || {}
    return Object.keys(web).map(k => k.slice(k.lastIndexOf(':') + 1))
  } catch { return [] }
}

// The command that publishes wherdr's port, as typed by hand (Docker mode).
// `httpsPort`: the tailnet port, wherdr's own by default.
export const publishCommand = (port, httpsPort = port) => `tailscale serve --bg --https=${httpsPort} http://127.0.0.1:${port}`
export const publishArgs = port => ['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`]
export const unpublishArgs = httpsPort => ['serve', `--https=${httpsPort}`, 'off']

// A tailnet address typed by hand: https://machine.tailnet.ts.net[:port]/ → its
// normalized form, or null.
export function tailnetUrl(text) {
  try {
    const u = new URL(String(text || '').trim())
    if (u.protocol !== 'https:' || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i.test(u.hostname) || u.username || u.password) return null
    return `https://${u.host.toLowerCase()}/`
  } catch { return null }
}

// A failed `tailscale serve` → { code, link } for the known causes, else null.
// code: 'operator' (Linux: the user may not change Tailscale's settings),
// 'https' (no HTTPS certificates on the tailnet), 'offline' (not connected).
export function serveError(output) {
  const text = String(output || '')
  const link = /https:\/\/login\.tailscale\.com\/\S+/.exec(text)?.[0]
  if (/access denied|permission denied|--operator|not permitted/i.test(text)) return { code: 'operator', link: LINKS.operator }
  if (/https?\b.*(not enabled|disabled)|serve.*not enabled|enable https|certificates?.*(not enabled|disabled)|\/f\/serve/i.test(text)) return { code: 'https', link: link || LINKS.https }
  if (/needslogin|not logged in|logged out|tailscale is stopped|is tailscale running|not running|failed to connect to local tailscale/i.test(text)) return { code: 'offline', link: LINKS.download }
  return null
}

// Tailscale's state for wherdr's port: { installed, bin, socket, connected,
// https, name, phone, taken, served }. Read with the CLI, or without one
// (Docker) from Tailscale's socket.
export async function inspect(port, bin = tailscaleBin(), socket = bin ? null : tailscaledSocket()) {
  if (!bin && !socket) return { installed: false }
  const run = args => exec(bin, args, { encoding: 'utf8', timeout: 8000 }).then(r => r.stdout, () => '')
  const status = tailnetStatus(bin ? await run(['status', '--json']) : await localApi(socket, 'status?peers=false'))
  const serve = !status.name ? '' : bin ? await run(['serve', 'status', '--json']) : await localApi(socket, 'serve-config')
  const phone = phoneAddress(status.name, port, serve)
  // Publishing on wherdr's port would replace whatever else is served there.
  const taken = Boolean(phone && !phone.served && servedPorts(serve).includes(String(port)))
  return { installed: true, bin, socket, ...status, phone, taken, served: servedAddresses(status.name, port, serve) }
}

// The tailnet's DNS suffix (tailnet.ts.net) from /etc/resolv.conf's search
// line: a Docker container copies it from the host when MagicDNS is on.
export function tailnetDomain(resolvConf) {
  for (const line of String(resolvConf || '').split('\n')) {
    const m = /^\s*search\s+(.+)$/.exec(line)
    const hit = m?.[1].split(/\s+/).find(d => /^[a-z0-9-]+\.ts\.net$/i.test(d))
    if (hit) return hit.toLowerCase()
  }
  return null
}

// Tailscale's DNS (MagicDNS): a Docker container does not use it, but reaches it.
const MAGIC_DNS = '100.100.100.100'

// The system's lookup, then MagicDNS for *.ts.net names.
function lookup(host, opts, cb) {
  dns.lookup(host, opts, (err, address, family) => {
    if (!err || !/\.ts\.net$/i.test(host)) return cb(err, address, family)
    const resolver = new dns.Resolver({ timeout: 3000, tries: 1 })
    resolver.setServers([MAGIC_DNS])
    resolver.resolve4(host, (e2, list) => {
      if (e2 || !list?.length) return cb(err)
      if (opts?.all) cb(null, list.map(a => ({ address: a, family: 4 })))
      else cb(null, list[0], 4)
    })
  })
}

// Does the phone address answer like wherdr? 'ok'; 'host' (wherdr answers but
// refuses the address: not in APP_URL yet); 'other' (something else answers:
// wherdr stopped, wrong port) or 'unreachable'.
export async function reachable(url, timeoutMs = 8000) {
  return (await probe(url, timeoutMs)).reach
}

// Why a request failed: 'dns' (name not found), 'refused', 'timeout', 'cert'
// (invalid certificate), 'tls' (no HTTPS on that port), or 'network'.
export function failureCause(err) {
  const code = String(err?.code || '')
  const msg = String(err?.message || '')
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NONAME') return 'dns'
  if (code === 'ECONNREFUSED') return 'refused'
  if (code === 'ETIMEDOUT' || msg === 'timeout') return 'timeout'
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/.test(code)) return 'cert'
  if (code === 'EPROTO' || /wrong version number|ssl3_get_record|packet length/i.test(msg)) return 'tls'
  return 'network'
}

// reachable() with the details: { reach, cause?, status? }: `cause` when
// unreachable (failureCause), `status` the HTTP code when something answered.
export function probe(url, timeoutMs = 8000) {
  const { promise, resolve } = Promise.withResolvers()
  let u
  try { u = new URL('manifest.webmanifest', url) } catch { return Promise.resolve({ reach: 'unreachable', cause: 'network' }) }
  // Accept JSON: a refused host then answers { code: 'host' }, not the HTML page.
  const req = https.get(u, { lookup, timeout: timeoutMs, headers: { accept: 'application/json' } }, (res) => {
    let text = ''
    res.setEncoding('utf8')
    res.on('data', (c) => { if (text.length < 65536) text += c })
    res.on('end', () => {
      const status = res.statusCode || 0
      if (status >= 200 && status < 300) resolve({ reach: text.includes('wherdr') ? 'ok' : 'other', status })
      else resolve({ reach: status === 403 && /"code"\s*:\s*"host"/.test(text) ? 'host' : 'other', status })
    })
    res.on('error', e => resolve({ reach: 'unreachable', cause: failureCause(e) }))
  })
  req.on('timeout', () => req.destroy(new Error('timeout')))
  req.on('error', e => resolve({ reach: 'unreachable', cause: failureCause(e) }))
  return promise
}

// Runs `tailscale <args>` without a terminal → { code, output }. On a tailnet
// without HTTPS, `tailscale serve` prints a link and waits: the timeout ends it.
export function runTailscale(bin, args, timeoutMs = 30_000) {
  return exec(bin, args, { encoding: 'utf8', timeout: timeoutMs }).then(
    r => ({ code: 0, output: `${r.stdout}${r.stderr}` }),
    e => ({ code: typeof e.code === 'number' ? e.code : -1, output: `${e.stdout || ''}${e.stderr || ''}${e.message || ''}` }),
  )
}
