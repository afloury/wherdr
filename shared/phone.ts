// Settings › Phone: the state of the phone address (GET /api/phone) and
// the result of its actions (POST /api/phone).

export type PhoneMode = 'native' | 'missing'
// See bin/lib/tailnet.mjs reachable(). 'pending': not answering yet, but
// still within the first minute and a half, when Tailscale is getting the
// HTTPS certificate (phoneReach below).
export type PhoneReach = 'ok' | 'host' | 'other' | 'unreachable' | 'pending'
// Why it is unreachable: name not found, connection refused, timeout,
// invalid certificate, no HTTPS on that port, other network error.
export type PhoneReachCause = 'dns' | 'refused' | 'timeout' | 'cert' | 'tls' | 'network'
// Known failures: Linux operator rights, HTTPS off on the tailnet, Tailscale
// not connected, the HTTPS port serves something else,
// anything else (`detail` holds Tailscale's output).
export type PhoneError = 'operator' | 'https' | 'offline' | 'taken' | 'failed'

// How long a freshly published (or first checked) address may fail with a
// transient cause before it counts as an error.
export const PHONE_GRACE_MS = 90_000
// Causes that only mean "not ready yet" while Tailscale sets HTTPS up.
const TRANSIENT: Partial<Record<PhoneReachCause, true>> = { timeout: true, tls: true, refused: true, cert: true, network: true }

// The probe's answer → the reach shown: a transient failure within
// PHONE_GRACE_MS of `since` (when the wait started) is 'pending'.
export function phoneReach(probe: { reach: Exclude<PhoneReach, 'pending'>, cause?: PhoneReachCause | null }, since: number, now = Date.now()): PhoneReach {
  if (probe.reach !== 'unreachable') return probe.reach
  return probe.cause && TRANSIENT[probe.cause] && now - since < PHONE_GRACE_MS ? 'pending' : 'unreachable'
}

export interface PhoneStatus {
  mode: PhoneMode
  // Server OS (process.platform), for the Tailscale download link.
  platform: string
  port: string
  connected: boolean
  // The tailnet issues HTTPS certificates (when `connected`).
  https: boolean
  url: string | null
  // Published by `tailscale serve`, as read from Tailscale.
  served: boolean
  // Also open to the Internet by `tailscale funnel`: wherdr does not enable it.
  funnel: boolean
  // native: wherdr's HTTPS port already serves something else.
  taken: boolean
  suggested: string | null
  command: string
  reach: PhoneReach | null
  // reach 'unreachable': why; 'other': the HTTP status that answered.
  reachCause: PhoneReachCause | null
  reachStatus: number | null
  // When `reach` was measured (ms since the epoch).
  checkedAt: number | null
  // APP_URL in use, and whether it comes from the environment (then it wins).
  appUrl: string
  appUrlFromEnv: boolean
  // QR code of `url`, only once the address answers: one SVG path.
  qr: { size: number, path: string } | null
}

export type PhoneResult =
  | { ok: true, status: PhoneStatus }
  | { ok: false, error: PhoneError, link?: string, detail?: string, status: PhoneStatus }
