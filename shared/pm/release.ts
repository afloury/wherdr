// A task that waits for the user lets its agents go: once they have been idle
// RELEASE_IDLE_MS, the engine ends them (worktree, branch and files stay) and
// starts the worker (or the reviewer) again in the same worktree when the task
// needs it. Only agents that hold a step under way count against a machine's
// cap. Pure: server/utils/pmRelease.ts reads the terminals and ends the agents.
import type { Run, Task } from './run'
import type { PlannedStep, StepState } from './steps'

export const RELEASE_IDLE_MS = 10 * 60_000

// Why a released worker's handover says it was stopped.
export const RELEASED_WHY = 'the task waited for the user and its agents were idle for 10 minutes, so they were ended to free memory'

// Waits for the user: Your turn (a step that ends by the user, a refused or
// guarded merge, a decision), or waiting on a failure. Not on an agent's
// question, a permission or a login, nor a step over its time: its agent must
// stay to get the answer, or to be looked at. Nor while the engine waits for
// work it handed the worker (a catch-up, red CI).
export const waitsForUser = (t: Task) => !!t.step?.started && !t.step.done && !t.step.acting && !t.step.agent
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

// The engine hands the worker work of its own (a catch-up, red CI) at the PR
// head `head`: the step leaves Your turn until a push or the worker's report.
// No head (a fix handed by a `tell --fix`): only its report, or its silence, ends it.
export const handToAgent = (s: StepState, kind: string, head: string | undefined, now: number): StepState =>
  ({ ...s, yourTurn: undefined, agent: { kind, ...(head ? { head } : {}), at: now, ...(s.yourTurn ?? s.agent?.was ? { was: s.yourTurn ?? s.agent?.was } : {}) } })

// That work is in: the step's Your turn, if it had one, comes back.
export const agentBack = ({ agent, ...s }: StepState): StepState => ({ ...s, ...(agent?.was ? { yourTurn: agent.was } : {}) })

// A failed engine action (a push refused, a PR not opened) handed to the
// agent with a fix: once that work is in, the engine tries the action again
// itself instead of handing the user its Try again.
export const retriesAction = (plan: PlannedStep[], s: StepState) =>
  !!s.agent && s.agent.was?.reason === 'action' && plan[s.at]?.ends === 'action'

// `tell --fix` on a task whose step action failed: the agent is fixing it,
// the step leaves Your turn (retriesAction). Undefined: no failed action.
export function handFix(plan: PlannedStep[], s: StepState | undefined, kind: string, now: number): StepState | undefined {
  if (!s?.started || s.done || s.acting || plan[s.at]?.ends !== 'action' || s.yourTurn?.reason !== 'action') return
  return handToAgent(s, `fix ${kind}`, undefined, now)
}

// How long the agent fixing a failed action may sit idle, its report not in,
// before the step goes back to the user.
export const FIX_QUIET_MS = 3 * 60_000

// The agent fixing a failed action, as the engine sees it this pass (its
// terminal's status; 'gone': ended): the step as it is, the agent's quiet
// time noted, or back to Your turn with the new reason once it stopped
// without a report. Undefined: nothing to change.
export function fixWatch(plan: PlannedStep[], s: StepState, status: 'working' | 'idle' | 'gone' | undefined, now: number): StepState | undefined {
  const work = s.agent
  if (!work || !retriesAction(plan, s) || status === undefined) return
  if (status === 'working') return work.idle === undefined ? undefined : { ...s, agent: { ...work, idle: undefined } }
  if (status === 'idle' && now - (work.idle ?? now) < FIX_QUIET_MS) return work.idle === undefined ? { ...s, agent: { ...work, idle: now } } : undefined
  const step = plan[s.at]!
  const error = `${work.kind}: the agent ${status === 'gone' ? 'ended' : 'stopped'} without saying it is done`
  const { agent: _, ...rest } = s
  return { ...rest, yourTurn: { reason: 'action', badge: `${step.badge || step.userLabel || step.id}: ${error}`, error } }
}

// Before its agents are released, the task branch's committed work goes to
// origin. A branch never pushed keeps its commits in the worktree, which stays.
// Exit 0 with "pushed" or nothing; else why it could not push.
export const PUSH_LEFT_SCRIPT = `cd "$1" || exit 1; b=$2
r=$(git ls-remote --heads origin "refs/heads/$b" 2>&1) || { echo "$r"; exit 1; }
[ -n "$r" ] || exit 0
git fetch -q origin "$b" 2>&1 || exit 1
[ -z "$(git rev-list FETCH_HEAD..HEAD)" ] && exit 0
git push -q origin "HEAD:refs/heads/$b" 2>&1 || exit 1
echo pushed`
