// What a task in the Working group is really doing, read from what
// herdr-projects reports for it (its stage and status message):
// - `running`: an agent works on it;
// - `ci`: the agent has finished and the board waits for the pull request's
//   GitHub checks ("Waiting for GitHub checks · 1 of 2 passed");
// - `queued`: it has not started, it waits behind other tasks ("queued after
//   DEMO-3", stage `after`) or for a free slot ("waiting for a free slot, Q#2",
//   stage `queued`).
// Anything else in the Working group reads as `running`, as before.
export type TaskActivity =
  | { kind: 'running' }
  | { kind: 'ci', passed: number | null, total: number | null }
  | { kind: 'queued', after: string | null, place: number | null }

export interface ActivityInput { group?: string, stage?: string, msg?: string, queue?: number | null }

const CI = /\bwaiting for (?:github )?checks\b/i
const CI_TALLY = /\b(\d{1,4}) of (\d{1,4}) passed\b/i
const AFTER = /\bqueued after\s+([\w.:/-]{1,80})/i
const SLOT = /\bwaiting for a free slot\b/i
const PLACE = /\bQ#(\d{1,5})\b/

// null: not a Working task (its group says what it does).
export function taskActivity(t: ActivityInput): TaskActivity | null {
  if (t.group !== undefined && t.group !== 'working') return null
  const msg = (t.msg || '').replace(/\s+/g, ' ').trim()
  const stage = t.stage || ''
  const after = AFTER.exec(msg)
  if (stage === 'queued' || stage === 'after' || after || SLOT.test(msg)) {
    const place = t.queue ?? (PLACE.exec(msg) ? Number(PLACE.exec(msg)![1]) : null)
    return { kind: 'queued', after: after ? after[1]!.replace(/[.,;:]+$/, '') : null, place: place && place > 0 ? place : null }
  }
  if (CI.test(msg)) {
    const m = CI_TALLY.exec(msg)
    const passed = m ? Number(m[1]) : null
    const total = m ? Number(m[2]) : null
    return passed !== null && total !== null && passed <= total ? { kind: 'ci', passed, total } : { kind: 'ci', passed: null, total: null }
  }
  return { kind: 'running' }
}

// The badge's short words: `CI 1/2`, `CI`; `after DEMO-3`, `Q#2` (after "Queued").
export function ciTally(a: Extract<TaskActivity, { kind: 'ci' }>): string {
  return a.total !== null ? `${a.passed}/${a.total}` : ''
}
export function queuedWhat(a: Extract<TaskActivity, { kind: 'queued' }>): string {
  return a.after || (a.place ? `Q#${a.place}` : '')
}
