import os from 'node:os'

function hostname(value: string): string | null {
  try {
    if (!value || /[\s/@?#]/.test(value)) return null
    const url = new URL(`http://${value}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  } catch { return null }
}

export function allowedHosts(appUrl = process.env.APP_URL || '', extra = process.env.HERDR_WEB_ALLOWED_HOSTS || '', interfaces = os.networkInterfaces()): Set<string> {
  const names = new Set(['localhost', '127.0.0.1', '::1', os.hostname().toLowerCase()])
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
// allowed yet gets HOST_REFUSED_PAGE, saying what to do; API requests (and
// anything else) keep the JSON error. The page is static on purpose: it
// reveals neither the allowed hosts nor APP_URL.
export function hostRefusalIsHtml(path: string, accept: string | string[] | undefined): boolean {
  return !path.startsWith('/api/') && /\btext\/html\b/i.test(Array.isArray(accept) ? accept.join(',') : accept || '')
}

export const HOST_REFUSED_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>wherdr · address not enabled</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f12;color:#e8eaed;font:15px/1.5 Inter,system-ui,-apple-system,sans-serif;padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left))}
main{max-width:440px;border:1px solid #3a3f47;padding:24px}
.tag{font:11px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#9aa0a8;margin:0 0 16px}
h1{font:600 20px/1.25 Archivo,system-ui,sans-serif;margin:0 0 8px}
p{margin:0 0 8px}hr{border:0;border-top:1px solid #3a3f47;margin:20px 0}
</style></head><body><main>
<p class="tag">wherdr · 403</p>
<h1>This address isn't enabled yet.</h1>
<p>On the computer, open wherdr → Settings › Phone (or press Check), then reload.</p>
<hr>
<h1 lang="fr">Cette adresse n’est pas encore activée.</h1>
<p lang="fr">Sur l’ordinateur, ouvre wherdr → Réglages › Téléphone (ou appuie sur Vérifier), puis recharge.</p>
</main></body></html>
`

// API request made from another page (link, <img>, fetch without CORS):
// some reads act on a pane (GET /api/models opens /model). Recent
// browsers say so in Sec-Fetch-Site; without that header (curl,
// old browsers), the request is accepted as before.
export function crossSiteRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const site = headers['sec-fetch-site']
  return typeof site === 'string' && site !== 'same-origin' && site !== 'none'
}
