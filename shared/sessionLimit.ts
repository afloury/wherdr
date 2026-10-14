// Passkey lock: time since the last passkey unlock before the device must
// unlock again, used or not in between (server setting, shared by every
// device). It is the only rule: there is no idle lock.
export const MAX_SESSION_DAYS = [1, 7, 30, 90, 365] as const
export type MaxSessionDays = typeof MAX_SESSION_DAYS[number]
export const DEFAULT_MAX_SESSION_DAYS: MaxSessionDays = 7
export const DAY_MS = 24 * 3600 * 1000
// The deadline only ends a session when the app opens: a client still open
// past it (never reopened) is cut this long after it.
export const OVERRUN_MS = 12 * 3600 * 1000

export function isMaxSessionDays(v: unknown): v is MaxSessionDays {
  return MAX_SESSION_DAYS.includes(v as MaxSessionDays)
}

// Window before the deadline in which the app warns that the next opening
// will ask for the passkey again.
export const DEADLINE_WARNING_MS = 6 * 3600 * 1000
