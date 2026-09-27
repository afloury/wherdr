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
