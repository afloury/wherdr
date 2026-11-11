// A task under way whose current step's holder has no running agent (released,
// ended on its own, lost in a restart): once that lasts AGENTLESS_MS, the
// engine starts it again (server/utils/pmWatchdog.ts). A try that fails is
// said on the status line; at the second, the coordinator is woken once. Pure.
import type { Task } from './run'
import type { PlannedStep } from './steps'
import { waitsForUser, waitsInQueue } from './release'

export const AGENTLESS_MS = 3 * 60_000

// Why a worker the watchdog starts again was stopped (its handover note).
export const AGENTLESS_WHY = 'its agent was no longer running while the task was under way, so the engine started a new one'

// The role whose agent the task needs now: working, its step under way and held
// by an agent, nothing asked of the user, no engine action or handed work
// (handedWatch's), not waiting in the merge queue. Undefined: none.
export function agentNeeded(task: Task, plan: PlannedStep[]): 'worker' | 'reviewer' | undefined {
  const s = task.step
  if (task.state !== 'working' || task.stopped || !s?.started || s.done || s.acting || s.agent || s.yourTurn) return
  // A review waiting in its account's queue: no agent is missing.
  if (waitsForUser(task) || waitsInQueue(task) || task.reviewWait) return
  const holder = plan[s.at]?.holder
  return holder === 'worker' || holder === 'reviewer' ? holder : undefined
}

// Since when the agent is missing, the failed tries, the coordinator woken.
export interface AgentWatch { since: number, fails: number, woke?: true }

// This pass: the watch carried on (undefined: nothing is missing) and whether a try is due.
export function watchAgent(prev: AgentWatch | undefined, missing: boolean, now: number): { watch?: AgentWatch, due: boolean } {
  if (!missing) return { due: false }
  const watch = prev ?? { since: now, fails: 0 }
  return { watch, due: now - watch.since >= AGENTLESS_MS }
}

// A try failed: counted, the next one AGENTLESS_MS later; wake: the second
// failure, the coordinator is woken (once, never again for this watch).
export function watchFailed(w: AgentWatch, now: number): { watch: AgentWatch, wake: boolean } {
  const fails = w.fails + 1, wake = fails >= 2 && !w.woke
  return { watch: { since: now, fails, ...(w.woke || wake ? { woke: true as const } : {}) }, wake }
}
