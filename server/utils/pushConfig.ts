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
