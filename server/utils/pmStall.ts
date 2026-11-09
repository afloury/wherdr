// A stalled task, on each engine pass (pm/blocked.ts): its stall saved on the
// task (the autopilot's 'stuck' wake reads it), the agent nudged once per
// cause, then handed to the user once (Tasks to handle, a 'needs-you'
// notification). Each step goes to the task's log.
import { SCRIPT } from '../../shared/pm/actions'
import { backToWork, failingTests, nudgeText, stallMoves, stallOf, type Stall } from '../../shared/pm/blocked'
import type { PlannedStep } from '../../shared/pm/steps'
import type { Run, Task } from '../../shared/pm/run'
import type { actionShell } from './pmActions'
import type { PmLaunchDeps } from './pmLaunch'
import type { PmStore } from './pmStore'
import { notificationAllowed } from './notificationRules'
import { pushSend } from './push'

export type StallNotify = (task: Task, s: Stall) => Promise<number>

const pushNotify: StallNotify = async (task, s) =>
  await notificationAllowed('needs-you', { workspaces: [] }, undefined, { machine: task.machine ?? '', project: task.project, board: true })
    ? pushSend({ title: `${task.id} needs you`, body: `${task.title}: stalled, ${s.reason}`, tag: `pm-stall-${task.id}`, url: `/#/board?task=${encodeURIComponent(task.id)}` })
    : 0

// The agent the stall waits on: the step's holder (idle), else the worker (red CI).
const agentOf = (task: Task, plan: PlannedStep[], runs: Run[], s: Stall) => {
  const role = s.cause.startsWith('idle:') ? plan[task.step!.at]?.holder : 'worker'
  return runs.filter(r => r.task === task.id && r.role === role && r.state !== 'ended' && r.terminal).sort((a, b) => b.startedAt - a.startedAt)[0]
}

export async function noteStall(deps: PmLaunchDeps, task: Task, plan: PlannedStep[], runs: Run[], worktree: string,
  sh: ReturnType<typeof actionShell>, now: number, notify: StallNotify = pushNotify): Promise<Task> {
  const { store } = deps
  const s = stallOf(task, plan, now)
  if (!s) {
    if (!task.stall) return task
    return store.logTask({ ...task, stall: undefined }, 'engine', `stall over: ${task.stall.reason}`)
  }
  const moves = stallMoves(task, s, now)
  const seen = task.stalls?.[s.cause] ?? { since: s.since }
  // Noted before anything is sent: one nudge and one hand-over per cause, whatever fails.
  const keep = Object.entries({ ...task.stalls, [s.cause]: { ...seen, ...(moves.nudge ? { nudged: now } : {}), ...(moves.handle ? { handled: now } : {}) } }).slice(-10)
  const next = { ...task, stall: s, stalls: Object.fromEntries(keep) }
  if (task.stall?.cause === s.cause && !moves.nudge && !moves.handle) return task.stall.since === s.since ? task : store.saveTask(next)
  let out = task.stall?.cause === s.cause ? await store.saveTask(next) : await store.logTask(next, 'engine', `stalled: ${s.reason}`)
  if (moves.nudge) {
    const agent = agentOf(task, plan, runs, s)
    const tests = s.cause.startsWith('red:') ? failingTests((await sh(SCRIPT.failedLog, [worktree, s.cause.slice(4)]).catch(() => null))?.out ?? '') : []
    const sent = agent && await deps.call('terminal.send', { terminal: agent.terminal, text: nudgeText(s, tests) }, 30000).then(() => true, () => false)
    out = await store.logTask(out, 'engine', sent
      ? `nudged the ${agent.role}${tests.length ? ` with the failing tests: ${tests.join('; ')}` : ''}`
      : 'could not nudge the agent: its terminal is gone')
  }
  if (moves.handle) {
    out = await store.logTask(out, 'engine', `still stalled after 30 min: in Tasks to handle (${s.reason})`)
    const n = await notify(out, s).catch(() => 0)
    out = await store.logTask(out, 'engine', n ? `notified the user (${n} device${n > 1 ? 's' : ''})` : 'no notification sent (none allowed or no device)')
  }
  return out
}

// The task's agent is back to work (pm/blocked.ts backToWork): saved, with a
// line in its log saying who. by: the log's author; who: who sent it back.
export async function noteBack(store: Pick<PmStore, 'logTask'>, task: Task, plan: PlannedStep[], by: string, who: string, now = Date.now()): Promise<Task> {
  const back = backToWork(task, plan, now)
  return back ? store.logTask(back, by, `back to work: ${who}`) : task
}
