// When the autopilot wakes next.
import { durationMs } from './steps'
import { nextRun, parseSchedule } from './schedule'
import type { Autopilot } from './autopilot'

// The next scheduled wake: its interval after the last one, or its next fixed
// time, whichever comes first. Off or with neither: none.
export function nextWakeAt(ap: Autopilot | undefined, ranAt: number | undefined, atRan: number | undefined, now: number): number | undefined {
  if (!ap?.on) return undefined
  const times: number[] = []
  if (ap.every) times.push(Math.max(now, (ranAt ?? 0) + durationMs(ap.every)))
  const at = ap.at ? parseSchedule(ap.at) : null
  const slot = at && !('error' in at) ? nextRun(at, atRan ?? now) : null
  if (slot !== null) times.push(Math.max(now, slot))
  return times.length ? Math.min(...times) : undefined
}
