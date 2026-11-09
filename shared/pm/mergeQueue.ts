// A project's merge queue: the tasks whose merge may go on (the engine merges
// it, or the user approved it) merge one at a time. The first is updated with
// its base, waits for its checks and merges; the others wait their turn, and
// are not updated meanwhile. Pure: server/utils/pmMechanic.ts keeps each
// task's place (task.queue) and carries out the first one's moves.
import { mayMerge, type ResolvedGuards } from './guards'
import { waitsToMerge, type PlannedStep, type StepState } from './steps'
import type { Task } from './run'

// May this merge step go on without the user: the guards give it to the
// engine, or the user approved it (a merge that waited for them).
export const mergeGoesOn = (step: PlannedStep | undefined, s: StepState, guards: ResolvedGuards, base: string) =>
  (step?.action?.kind === 'github.merge' && step.ends === 'action' && !step.guarded && mayMerge(guards, base, 'engine'))
  || (waitsToMerge(step) && !s.acting && !!s.approved)

// In the queue: working at such a merge step, with its PR open.
export function inMergeQueue(task: Task, plan: PlannedStep[], guards: ResolvedGuards, pr: { baseRefName: string, merged?: boolean } | undefined) {
  const s = task.step
  if (!s?.started || s.done || task.stopped || task.state !== 'working' || !pr || pr.merged) return false
  return mergeGoesOn(plan[s.at], s, guards, pr.baseRefName)
}

export interface QueueEntry {
  id: string
  files: string[] // the files its PR changes
  size: number // lines added and deleted
  first?: boolean // first already (its update runs, its agent resolves a conflict): it keeps its place
  red?: boolean // its checks failed: back to its worker, after the others
}

// The queue's order, by id. The first keeps its place unless its checks are
// red; then PRs that touch no file another queued PR touches, then smaller diffs.
export function mergeOrder(entries: QueueEntry[]): string[] {
  const first = entries.find(e => e.first && !e.red)
  const shares = (e: QueueEntry) => entries.some(o => o !== e && o.files.some(f => e.files.includes(f)))
  const rank = (e: QueueEntry) => [e.red ? 1 : 0, shares(e) ? 1 : 0, e.size] as const
  const rest = entries.filter(e => e !== first).sort((a, b) => {
    const x = rank(a), y = rank(b)
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.id.localeCompare(b.id)
  })
  return [...(first ? [first] : []), ...rest].map(e => e.id)
}

// "1st", "2nd", "3rd", "11th"…
export function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13
  return `${n}${teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}
