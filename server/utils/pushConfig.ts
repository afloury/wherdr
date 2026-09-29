// Seule une adresse HTTPS peut servir de contact VAPID pour cette app.
// En local ou avec une configuration invalide, le push reste indisponible.
export const FALLBACK_VAPID_SUBJECT = 'mailto:wherdr@localhost'

export function pushConfig(appUrl: string): { enabled: boolean, subject: string } {
  try {
    const url = new URL(appUrl)
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) {
      return { enabled: true, subject: url.href }
    }
  } catch { /* adresse absente ou invalide */ }
  return { enabled: false, subject: FALLBACK_VAPID_SUBJECT }
}

// Abonnement envoyé par le navigateur : le serveur postera ensuite vers
// `endpoint`, donc seulement une adresse HTTPS (service push), avec ses clés.
export function validPushSubscription(b: unknown): boolean {
  if (!b || typeof b !== 'object') return false
  const { endpoint, keys } = b as { endpoint?: unknown, keys?: { p256dh?: unknown, auth?: unknown } }
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password) return false
  } catch { return false }
  return Boolean(keys && typeof keys === 'object'
    && typeof keys.p256dh === 'string' && keys.p256dh.length > 0 && keys.p256dh.length <= 256
    && typeof keys.auth === 'string' && keys.auth.length > 0 && keys.auth.length <= 256)
}

// Nouvel abonnement d'un appareil : remplace son entrée (même endpoint) et,
// après une coupure puis une réactivation (le navigateur change d'endpoint),
// l'ancienne entrée `previous`, dont le silence encore actif est repris.
export function replaceSubscription<T extends { endpoint: string, quiet?: Q }, Q>(
  all: T[], next: T, previous: unknown, active: (quiet: Q) => boolean): T[] {
  const old = typeof previous === 'string' && previous !== next.endpoint ? previous : null
  const quiet = [next.endpoint, old].map(e => all.find(s => s.endpoint === e)?.quiet).find(q => q !== undefined && active(q))
  const subs = all.filter(s => s.endpoint !== next.endpoint && s.endpoint !== old)
  subs.push(quiet === undefined ? next : { ...next, quiet })
  return subs
}
