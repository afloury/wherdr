import os from 'node:os'

function hostname(value: string): string | null {
  try {
    if (!value || /[\s/@?#]/.test(value)) return null
    const url = new URL(`http://${value}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  } catch { return null }
}

// Host names of the addresses `tailscale serve` publishes for wherdr's own
// port, as last read from Tailscale itself (server/utils/phone.ts,
// adoptServed): allowed while they are published, refused again once removed.
// Never filled from a request: only the owner of the machine sets these.
let servedHosts: string[] = []
export function setServedHosts(urls: string[]) {
  servedHosts = urls.flatMap((url) => { try { return [new URL(url).hostname.toLowerCase()] } catch { return [] } })
}

export function allowedHosts(appUrl = process.env.APP_URL || '', extra = process.env.HERDR_WEB_ALLOWED_HOSTS || '', interfaces = os.networkInterfaces(), served = servedHosts): Set<string> {
  const names = new Set(['localhost', '127.0.0.1', '::1', os.hostname().toLowerCase(), ...served])
  try { if (appUrl) names.add(new URL(appUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '')) } catch { /* avertissement APP_URL ailleurs */ }
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) names.add(address.address.toLowerCase().replace(/%.+$/, ''))
  }
  for (const item of extra.split(',')) {
    const name = hostname(item.trim())
    if (name) names.add(name)
  }
  return names
}

export function hostAllowed(host: string | undefined, names = allowedHosts()): boolean {
  const name = hostname(host || '')
  return Boolean(name && names.has(name))
}

// A browser (Accept: text/html) opening a page on an address that is not
// allowed yet gets hostRefusedPage(), saying what to run; API requests (and
// anything else) keep the JSON error. The page reveals neither the allowed
// hosts nor APP_URL, and never echoes the request.
export function hostRefusalIsHtml(path: string, accept: string | string[] | undefined): boolean {
  return !path.startsWith('/api/') && /\btext\/html\b/i.test(Array.isArray(accept) ? accept.join(',') : accept || '')
}

// The command that checks and fixes the phone address on the machine, which
// may have no screen: `wherdr phone` where that command exists (npm, Homebrew),
// else the installer, which ends with the same check (Docker, Herdr plugin).
// `wherdr phone` looks at its default port: one started on another port
// (--port, PORT=…, from the sources) is named, or the command checks nothing.
const CLI_DEFAULT_PORT = '7683'
export function phoneFixCommand(install = process.env.WHERDR_INSTALL || '', port = process.env.NITRO_PORT || process.env.PORT || ''): string {
  if (install === 'docker' || install === 'docker-build' || install === 'plugin') return 'curl -fsSL https://wherdr.dev/install | sh'
  const command = install === 'brew' || install === 'npm-global' ? 'wherdr phone' : 'npx wherdr phone'
  return /^\d+$/.test(port) && port !== CLI_DEFAULT_PORT ? `${command} --port ${port}` : command
}

// Whether the refused name is a tailnet one (what `tailscale serve` publishes).
// Only this yes/no reaches the page, never the Host header itself.
export function tailnetName(host: string | undefined): boolean {
  return /\.ts\.net$/.test(hostname(host || '') || '')
}

// `host`: the refused Host header. A tailnet name gets the command alone; any
// other name (LAN name, IP address, reverse proxy) also gets the setting that
// allows it, since no command can add it.
export function hostRefusedPage(install?: string, host?: string, port?: string): string {
  const kind = install ?? process.env.WHERDR_INSTALL ?? ''
  const command = phoneFixCommand(kind, port)
  const docker = kind === 'docker' || kind === 'docker-build'
  const where = docker ? 'in the container\'s environment' : 'in <code>~/wherdr/wherdr.env</code>'
  const whereFr = docker ? 'dans l’environnement du conteneur' : 'dans <code>~/wherdr/wherdr.env</code>'
  const other = !tailnetName(host)
  const serve = other ? 'If you reach wherdr through <code>tailscale serve</code>, wherdr enables that address by itself.' : 'wherdr enables by itself the address <code>tailscale serve</code> publishes for it.'
  const serveFr = other ? 'Si tu passes par <code>tailscale serve</code>, wherdr active cette adresse tout seul.' : 'wherdr active tout seul l’adresse que <code>tailscale serve</code> publie pour lui.'
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>wherdr · address not enabled</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f12;color:#e8eaed;font:15px/1.5 Inter,system-ui,-apple-system,sans-serif;padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left))}
main{max-width:480px;border:1px solid #3a3f47;padding:24px}
.tag{font:11px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#9aa0a8;margin:0 0 16px}
h1{font:600 20px/1.25 Archivo,system-ui,sans-serif;margin:0 0 8px}
p{margin:0 0 12px}pre+p{margin-top:16px}p:last-child{margin-bottom:0}hr{border:0;border-top:1px solid #3a3f47;margin:20px 0}
code{font:13px/1.45 "JetBrains Mono",ui-monospace,monospace;overflow-wrap:anywhere}
pre{margin:0;padding:10px 12px;border:1px solid #3a3f47;background:#15181d;white-space:pre-wrap;overflow-wrap:anywhere;user-select:all;-webkit-user-select:all}
</style></head><body><main>
<p class="tag">wherdr · 403</p>
<h1>This address isn't enabled yet.</h1>
<p>${serve} On the machine that runs wherdr, run this, then reload:</p>
<pre><code>${command}</code></pre>${other ? `
<p>For any other private name or IP address, add it to <code>HERDR_WEB_ALLOWED_HOSTS</code> (comma-separated) ${where}, then restart wherdr.</p>` : ''}
<hr>
<h1 lang="fr">Cette adresse n’est pas encore activée.</h1>
<p lang="fr">${serveFr} Sur la machine qui fait tourner wherdr, lance ceci, puis recharge :</p>
<pre><code>${command}</code></pre>${other ? `
<p lang="fr">Pour tout autre nom privé ou adresse IP, ajoute-le à <code>HERDR_WEB_ALLOWED_HOSTS</code> (séparés par des virgules) ${whereFr}, puis redémarre wherdr.</p>` : ''}
</main></body></html>
`
}

// API request made from another page (link, <img>, fetch without CORS):
// some reads act on a pane (GET /api/models opens /model). Recent
// browsers say so in Sec-Fetch-Site; without that header (curl,
// old browsers), the request is accepted as before.
export function crossSiteRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const site = headers['sec-fetch-site']
  return typeof site === 'string' && site !== 'same-origin' && site !== 'none'
}
