// The phone address: wherdr published on the tailnet by `tailscale serve`
// (private, only your devices). Reads Tailscale's state, publishes and
// unpublishes wherdr's port, and checks that the address really answers.
// Used by the server (Settings › Phone, server/utils/phone.ts) and by
// `wherdr phone` / `wherdr panel`. No dependency on the rest of bin/lib nor
// on packages: the server bundles this file.
import { execFile } from 'node:child_process'
import dns from 'node:dns'
import { existsSync } from 'node:fs'
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

// Phone address: the `tailscale serve` entry whose proxy targets wherdr's
// local port (served on any HTTPS port), else the address publishing would
// give (same port) with served: false. Null without a tailnet name.
export function phoneAddress(name, port, serveJson) {
  if (!name) return null
  let web = {}
  try { web = JSON.parse(serveJson || '{}')?.Web || {} } catch {}
  const target = new RegExp(`^(https?://)?(127\\.0\\.0\\.1|localhost):${port}/?$`)
  for (const [hostPort, entry] of Object.entries(web)) {
    if (!Object.values(entry?.Handlers || {}).some(h => target.test(h?.Proxy || ''))) continue
    const servedPort = hostPort.slice(hostPort.lastIndexOf(':') + 1)
    return { url: `https://${name}${servedPort === '443' ? '' : `:${servedPort}`}/`, served: true, httpsPort: servedPort }
  }
  return { url: `https://${name}:${port}/`, served: false, httpsPort: String(port) }
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

// Tailscale's state for wherdr's port: { installed, bin, connected, https, name, phone, taken }.
export async function inspect(port, bin = tailscaleBin()) {
  if (!bin) return { installed: false }
  const run = args => exec(bin, args, { encoding: 'utf8', timeout: 8000 }).then(r => r.stdout, () => '')
  const status = tailnetStatus(await run(['status', '--json']))
  const serve = status.name ? await run(['serve', 'status', '--json']) : ''
  const phone = phoneAddress(status.name, port, serve)
  // Publishing on wherdr's port would replace whatever else is served there.
  const taken = Boolean(phone && !phone.served && servedPorts(serve).includes(String(port)))
  return { installed: true, bin, ...status, phone, taken }
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
