// Passkey lock: maximum time since the last passkey unlock before the device
// must unlock again (server setting, shared by every device). The 12 h idle
// slide still applies on top of it.
export const MAX_SESSION_DAYS = [1, 7, 30, 90, 365] as const
export type MaxSessionDays = typeof MAX_SESSION_DAYS[number]
export const DEFAULT_MAX_SESSION_DAYS: MaxSessionDays = 7
export const DAY_MS = 24 * 3600 * 1000

export function isMaxSessionDays(v: unknown): v is MaxSessionDays {
  return MAX_SESSION_DAYS.includes(v as MaxSessionDays)
}

// Window before the deadline in which the app warns that the next opening
// will ask for the passkey again.
export const DEADLINE_WARNING_MS = 6 * 3600 * 1000
