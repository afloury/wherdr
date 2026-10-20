import type { Quiet } from '#shared/quiet'

// When a quiet period ends, as the home hint and Settings › Notifications word it:
// never (until turned back on), later today, tomorrow, or a later day.
export type QuietEnd =
  | { kind: 'manual' }
  | { kind: 'today' | 'tomorrow' | 'later', at: number }

export function quietPeriodEnd(q: Quiet, now: number): QuietEnd {
  if (q.until === null) return { kind: 'manual' }
  const end = new Date(q.until)
  const day = new Date(now)
  if (end.toDateString() === day.toDateString()) return { kind: 'today', at: q.until }
  day.setDate(day.getDate() + 1)
  if (end.toDateString() === day.toDateString()) return { kind: 'tomorrow', at: q.until }
  return { kind: 'later', at: q.until }
}
