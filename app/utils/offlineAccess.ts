// Le serveur reste autorité. Ce témoin ne sert qu'à masquer le cache quand
// le serveur est absent ; aucun contenu privé n'y est enregistré.
export interface OfflineAccess { enabled: boolean, expiresAt: number }
export const ACCESS_KEY = 'wherdr-offline-access'
export function mayReadOffline(access: OfflineAccess | null, now = Date.now()): boolean {
  return Boolean(access && (!access.enabled || (access.expiresAt > now && access.expiresAt <= now + 12 * 3600 * 1000)))
}
export function readOfflineAccess(): OfflineAccess | null {
  try {
    const v = JSON.parse(localStorage.getItem(ACCESS_KEY) || 'null')
    return v && typeof v.enabled === 'boolean' && Number.isFinite(v.expiresAt) ? v : null
  } catch { return null }
}
export function setOfflineAccess(access: OfflineAccess | null) {
  try {
    if (access) localStorage.setItem(ACCESS_KEY, JSON.stringify(access))
    else localStorage.removeItem(ACCESS_KEY)
  } catch { /* accès indisponible : le cache reste fermé */ }
}
