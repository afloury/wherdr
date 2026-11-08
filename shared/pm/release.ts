// A task that waits for the user lets its agents go: once they have been idle
// RELEASE_IDLE_MS, the engine ends them (worktree, branch and files stay) and
// starts the worker (or the reviewer) again in the same worktree when the task
// needs it. Only agents that hold a step under way count against a machine's
// cap. Pure: server/utils/pmRelease.ts reads the terminals and ends the agents.
import type { Run, Task } from './run'

export const RELEASE_IDLE_MS = 10 * 60_000

// Why a released worker's handover says it was stopped.
export const RELEASED_WHY = 'the task waited for the user and its agents were idle for 10 minutes, so they were ended to free memory'

// Waits for the user: Your turn (a step that ends by the user, a refused or
// guarded merge, a decision), or waiting on a failure. Not on an agent's
// question, a permission or a login, nor a step over its time: its agent must
// stay to get the answer, or to be looked at.
export const waitsForUser = (t: Task) => !!t.step?.started && !t.step.done && !t.step.acting
  && ((!!t.step.yourTurn && t.step.yourTurn.reason !== 'timeout') || (t.state === 'waiting' && !t.waitKind))

// When the task's agents became idle while it waits for the user, carried
// from one tick to the next; undefined when it does not wait or one works.
export const idleSince = (prev: number | undefined, task: Task, busy: boolean, now: number) =>
  !waitsForUser(task) || busy ? undefined : prev ?? now

export const releaseDue = (since: number | undefined, now: number) => since !== undefined && now - since >= RELEASE_IDLE_MS

// The worker the engine released: started again when the task needs it.
export const wasReleased = (r?: Pick<Run, 'state' | 'endedBy'>) => r?.state === 'ended' && r.endedBy === 'released'

// The agents a machine's cap counts: running there, holding their task's
// current step, the task not waiting for the user. Coordinators are no runs.
// Returns their runs.
export function agentsAtWork(runs: Run[], tasks: Task[], machine: string, holder: (t: Task) => string | undefined) {
  return runs.filter((r) => {
    if (r.machine !== machine || r.state === 'ended') return false
    const t = tasks.find(x => x.id === r.task)
    return !!t && !t.step?.done && !waitsForUser(t) && (!t.step?.started || holder(t) === r.role)
  })
}
