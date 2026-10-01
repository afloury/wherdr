// Quiet mode: no push notification while it is active, for one
// device (its subscription) or for all. `until`: end in ms (epoch), or null
// for "until turned back on". An expired quiet period no longer counts: back to
// normal is automatic, without a scheduled task.
export interface Quiet { until: number | null }
export type QuietScope = 'device' | 'all'
export type QuietDuration = 'hour' | 'morning' | 'manual'

// Bound on accepted durations (a longer quiet period = "until turned back on").
export const QUIET_MAX_MS = 7 * 24 * 3600 * 1000

export function quietActive(q: Quiet | null | undefined, now = Date.now()): boolean {
  return Boolean(q) && (q!.until === null || now < q!.until)
}

export function silenced(global: Quiet | null | undefined, device: Quiet | null | undefined, now = Date.now()): boolean {
  return quietActive(global, now) || quietActive(device, now)
}

// Next 8 am (local time) strictly after `now`: tomorrow morning, or this
// morning if muted in the middle of the night.
export function nextMorning(now: Date, hour = 8): number {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  return d.getTime()
}

export function quietUntil(duration: QuietDuration, now = new Date()): number | null {
  if (duration === 'hour') return now.getTime() + 3600 * 1000
  if (duration === 'morning') return nextMorning(now)
  return null
}

// Request body -> valid quiet period, `null` to stop, `undefined` if rejected.
export function parseQuiet(on: unknown, until: unknown, now = Date.now()): Quiet | null | undefined {
  if (on === false) return null
  if (on !== true) return undefined
  if (until === null || until === undefined) return { until: null }
  if (typeof until !== 'number' || !Number.isFinite(until) || until <= now || until > now + QUIET_MAX_MS) return undefined
  return { until: Math.round(until) }
}
