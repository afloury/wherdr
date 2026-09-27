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
