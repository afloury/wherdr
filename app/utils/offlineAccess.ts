// The server stays the authority. This marker only serves to hide the cache when
// the server is absent; no private content is stored in it.
export interface OfflineAccess { enabled: boolean, expiresAt: number }
export const ACCESS_KEY = 'wherdr-offline-access'
export function mayReadOffline(access: OfflineAccess | null, now = Date.now()): boolean {
  return Boolean(access && (!access.enabled || (access.expiresAt > now && access.expiresAt <= now + 12 * 3600 * 1000)))
}
// Lease from /api/auth/status, on the client's clock: the server's expiresAt is
// shifted by the server/client clock difference, so a browser clock running
// behind the server does not make a fresh lease look invalid.
export function leaseFromStatus(st: { enabled: boolean, expiresAt?: number | null, now?: number }, now = Date.now()): OfflineAccess {
  if (!st.enabled) return { enabled: false, expiresAt: 0 }
  if (!st.expiresAt) return { enabled: true, expiresAt: 0 }
  return { enabled: true, expiresAt: now + st.expiresAt - (st.now ?? now) }
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
  } catch { /* access unavailable: the cache stays closed */ }
}
