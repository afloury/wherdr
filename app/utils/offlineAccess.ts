// The server stays the authority. This marker only serves to hide the cache when
// the server is absent; no private content is stored in it.
// expiresAt: when the server cuts the session at the latest; deadline: end of
// the duration since the passkey unlock (past it, the cache stays closed until
// unlocked again).
import { DAY_MS, MAX_SESSION_DAYS, OVERRUN_MS } from '../../shared/sessionLimit'

export interface OfflineAccess { enabled: boolean, expiresAt: number, deadline?: number }
export const ACCESS_KEY = 'wherdr-offline-access'
// No session lasts longer: a lease further ahead is not one the server gave.
const LONGEST_MS = Math.max(...MAX_SESSION_DAYS) * DAY_MS + OVERRUN_MS
export function mayReadOffline(access: OfflineAccess | null, now = Date.now()): boolean {
  return Boolean(access && (!access.enabled || (access.expiresAt > now && access.expiresAt <= now + LONGEST_MS
    && (access.deadline === undefined || access.deadline > now))))
}
// Lease from /api/auth/status, on the client's clock: the server's times are
// shifted by the server/client clock difference, so a browser clock running
// behind the server does not make a fresh lease look invalid.
export function leaseFromStatus(st: { enabled: boolean, expiresAt?: number | null, deadline?: number, now?: number }, now = Date.now()): OfflineAccess {
  if (!st.enabled) return { enabled: false, expiresAt: 0 }
  if (!st.expiresAt) return { enabled: true, expiresAt: 0 }
  const shift = now - (st.now ?? now)
  return { enabled: true, expiresAt: st.expiresAt + shift, ...(st.deadline ? { deadline: st.deadline + shift } : {}) }
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
