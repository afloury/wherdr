// A stalled task: it holds a slot, nothing moves, and the machine could still
// fix it (the agent fixes its CI, the idle agent goes on). The board card shows
// a small warning with the reason; unresolved for HANDLE_AFTER_MS, the task
// waits for the user (Your turn, the sidebar's Tasks to handle). What already
// waits for the user (a refused merge, a failed action, a question) is in Your
// turn at once, not here. Pure: the engine's pass records what it reads
// (task.ci, task.idle), the board computes from it.
import type { PlannedStep } from './steps'
import type { Task } from './run'

// Red CI sent to the agent, still red on that same commit, no other engine move.
export const RED_CI_WAIT_MS = 15 * 60_000
// The agent holding the step idle after its instructions were delivered.
export const IDLE_WAIT_MS = 5 * 60_000
// A stall still there this long after it began: the user's.
export const HANDLE_AFTER_MS = 30 * 60_000

export interface Stall { reason: string, since: number } // since: when it began

const current = (task: Task, plan: PlannedStep[]) => {
  const s = task.step
  return s?.started && !s.done && !task.stopped && task.state === 'working' && !s.yourTurn ? { s, step: plan[s.at] } : undefined
}

// The step waits for its holder's report or verdict, and its instructions were delivered.
export function awaitsHolder(task: Task, plan: PlannedStep[]): boolean {
  const c = current(task, plan)
  return !!c?.step && !c.s.acting && (c.step.holder === 'worker' || c.step.holder === 'reviewer')
    && (c.step.ends === 'report' || c.step.ends === 'verdict') && c.s.told === c.s.since
}

export function stallOf(task: Task, plan: PlannedStep[], now: number): Stall | undefined {
  const c = current(task, plan)
  if (!c?.step) return
  const since = c.s.since ?? 0
  const sent = task.ci?.red ? task.mech?.[`red:${task.ci.head}`] : undefined
  const last = Math.max(0, ...Object.values(task.mech ?? {}))
  if (sent !== undefined && sent === last && sent >= since && now - sent >= RED_CI_WAIT_MS)
    return { reason: 'CI red, no new push for 15 min', since: sent + RED_CI_WAIT_MS }
  if (task.idle !== undefined && awaitsHolder(task, plan)) {
    const from = Math.max(task.idle, since) + IDLE_WAIT_MS
    if (now >= from) return { reason: `The ${c.step.holder} stopped before saying it is done`, since: from }
  }
}

// What the board says of a stalled task once it is the user's.
export const stallTurn = (s: Stall) => `Stalled: ${s.reason}`
