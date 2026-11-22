// Settings › Pace's weekly chart of an account (WHR-557): the week's usage
// since the last weekly reset, from the pacing log (shared/pacingLog.ts), and
// the mode's target line, or the reserve's limit in 'free'. Pure.
//
// Usage starts at the first reading of the week: before it there is nothing
// to draw (a gap, never a made-up 0). Lines are only logged on change, so a
// value holds until the next line, and the latest reading carries it to the
// time it was read, not further.
import type { PacingEntry } from './pacingLog'
import { dayShares, targetLine, type PacePolicy } from './pm/pacing'

export interface ChartPoint { t: number, v: number }
export interface WeekSeries {
  from: number // the last weekly reset (resetsAt - 7 days)
  to: number // the next one
  now: number
  usage: ChartPoint[] // steps: two points at each change
  target: ChartPoint[] | null // null: 'unlimited' (shown as 'Free'), no line
  label: 'line' | 'reserve'
}

const DAY = 86_400_000
const SAME_WINDOW = 10 * 60000

// Two points at each change, so a straight line draws steps.
function steps(points: ChartPoint[]): ChartPoint[] {
  const out: ChartPoint[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && last.v !== p.v) out.push({ t: p.t, v: last.v })
    out.push(p)
  }
  return out
}

// The target in force at `t`: the line of 'workdays' / 'everyday', or 'free''s
// limit (100 - the reserve of the days left before the reset).
function targetAt(p: PacePolicy, resetsAt: number, t: number) {
  if (p.mode === 'free') return Math.max(0, 100 - p.reservePerDay * Math.ceil((resetsAt - t) / DAY))
  return targetLine(p, resetsAt, t)
}

// The times the target steps at: midnights for a line, whole days before the
// reset for 'free'.
function targetTimes(p: PacePolicy, from: number, to: number) {
  const inside = p.mode === 'free'
    ? Array.from({ length: 6 }, (_, i) => to - (6 - i) * DAY)
    : dayShares(() => true, to).map(d => d.start)
  return [from, ...inside.filter(t => t > from && t < to)]
}

// `reading`: the account's latest reading (its time and weekly %), which
// carries the last value up to when it was read.
export function weekSeries(entries: PacingEntry[], account: string, policy: PacePolicy, resetsAt: number, now: number, reading?: { at: number, used: number }): WeekSeries {
  const from = resetsAt - 7 * DAY
  const end = Math.min(now, resetsAt)
  const inWeek = (e: PacingEntry) => e.reset === null || Math.abs(e.reset - resetsAt) <= SAME_WINDOW
  const points = entries
    .filter(e => e.account === account && e.week !== null && e.at >= from && e.at <= end && inWeek(e))
    .sort((a, b) => a.at - b.at)
    .map(e => ({ t: e.at, v: e.week! }))
  const last = points[points.length - 1]
  if (reading && reading.at >= from && reading.at <= end && (!last || reading.at > last.t)) points.push({ t: reading.at, v: reading.used })
  const target = policy.mode === 'unlimited'
    ? null
    : steps([...targetTimes(policy, from, resetsAt).map(t => ({ t, v: targetAt(policy, resetsAt, t) })), { t: resetsAt, v: targetAt(policy, resetsAt, resetsAt - 1) }])
  return { from, to: resetsAt, now, usage: steps(points), target, label: policy.mode === 'free' ? 'reserve' : 'line' }
}
