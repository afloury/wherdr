// Settings › Phone: the state of the phone address (GET /api/phone) and
// the result of its actions (POST /api/phone).

// native: wherdr can run the tailscale CLI itself; docker: it cannot (the
// container), the user runs the command on the host; missing: no Tailscale.
export type PhoneMode = 'native' | 'docker' | 'missing'
// See bin/lib/tailnet.mjs reachable().
export type PhoneReach = 'ok' | 'host' | 'other' | 'unreachable'
// Why it is unreachable: name not found, connection refused, timeout,
// invalid certificate, no HTTPS on that port, other network error.
export type PhoneReachCause = 'dns' | 'refused' | 'timeout' | 'cert' | 'tls' | 'network'
// Known failures: Linux operator rights, HTTPS off on the tailnet, Tailscale
// not connected, the HTTPS port serves something else, a bad typed address,
// anything else (`detail` holds Tailscale's output).
export type PhoneError = 'operator' | 'https' | 'offline' | 'taken' | 'address' | 'failed'

export interface PhoneStatus {
  mode: PhoneMode
  // Server OS (process.platform), for the Tailscale download link.
  platform: string
  port: string
  // native: Tailscale is up and this machine has a tailnet name.
  connected: boolean
  // native: the tailnet issues HTTPS certificates.
  https: boolean
  // The phone address being checked: published (native) or typed (docker).
  url: string | null
  // native: published by `tailscale serve`.
  served: boolean
  // native: wherdr's HTTPS port already serves something else.
  taken: boolean
  // The address publishing would give (native) or a guess (docker).
  suggested: string | null
  // The command to run by hand (docker).
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
