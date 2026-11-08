// When a task is blocked: it holds a slot and nothing moves. The engine says
// why in plain words; the board card and the sidebar rows of its agents show
// it. Pure: the server gives the task, the browser the agent's live state.
import type { Card } from './board'
import type { PlannedStep } from './steps'
import type { Task } from './run'

// Red CI sent to the agent, and still red on that same commit (no fix pushed
// or committed), with no other engine move or step change, for this long.
export const RED_CI_WAIT_MS = 15 * 60_000
// An engine action (push, PR, landing) refused this many times in a row.
export const ACTION_TRIES = 3
const MERGES = ['github.merge', 'git.land']

// The error of a failed action, without the step's own label (steps.ts badge).
const actionError = (step: PlannedStep, badge: string) => {
  const head = `${step.badge || step.userLabel || step.id}: `
  return badge.startsWith(head) ? badge.slice(head.length) : badge
}

// What the server knows alone: a refused merge, an action failing again and
// again, red CI the agent left alone.
export function blockedOf(task: Task, plan: PlannedStep[], now: number): string | undefined {
  const s = task.step, step = s?.started && !s.done ? plan[s.at] : undefined
  if (!step || task.stopped || task.state !== 'working') return
  if (s!.yourTurn?.reason === 'action' && step.action) {
    const error = actionError(step, s!.yourTurn.badge)
    if (MERGES.includes(step.action.kind)) return `Merge refused: ${error}`
    const n = s!.tries?.[step.id] ?? 0
    if (n >= ACTION_TRIES) return `${step.id} failed ${n} times: ${error}`
  }
  const sent = task.ci?.red ? task.mech?.[`red:${task.ci.head}`] : undefined
  const last = Math.max(0, ...Object.values(task.mech ?? {}))
  if (sent !== undefined && sent === last && sent >= (s!.since ?? 0) && now - sent >= RED_CI_WAIT_MS) return 'CI red, no new push for 15 min'
}

// The step waits for its holder's report or verdict, and its instructions were delivered.
export function awaitsHolder(task: Task, plan: PlannedStep[]): boolean {
  const s = task.step, step = s?.started && !s.done ? plan[s.at] : undefined
  return !!step && !task.stopped && task.state === 'working' && !s!.yourTurn && !s!.acting
    && (step.holder === 'worker' || step.holder === 'reviewer')
    && (step.ends === 'report' || step.ends === 'verdict') && s!.told === s!.since
}

// What a task asks of the user, if anything: blocked first, then Your turn.
export type TaskMark = { kind: 'blocked' | 'your-turn', reason: string }
export type MarkFacts = Pick<Card, 'holder' | 'yourTurn' | 'blocked' | 'awaits'>
// holderStatus: the live state of the agent holding the step (herdr-core).
export function taskMark(c: MarkFacts, holderStatus?: string | null): TaskMark | undefined {
  if (c.blocked) return { kind: 'blocked', reason: c.blocked }
  if (c.awaits && (holderStatus === 'idle' || holderStatus === 'done'))
    return { kind: 'blocked', reason: `${c.holder === 'reviewer' ? 'Reviewer' : 'Worker'} stopped before saying it is done` }
  if (c.yourTurn) return { kind: 'your-turn', reason: c.yourTurn }
}

// A task's agents, for the sidebar (GET /api/pm/agents).
export interface AgentTask extends MarkFacts { id: string, terminal?: string, terminals: string[] }

// The mark of the task an agent terminal works for: its worker's and its
// reviewer's rows take the task's state. statusOf: a terminal's live state.
export function markOfTerminal(tasks: AgentTask[], address: string | undefined, statusOf: (terminal: string) => string | null | undefined) {
  const a = address ? tasks.find(x => x.terminals.includes(address)) : undefined
  return a && taskMark(a, a.terminal ? statusOf(a.terminal) : undefined)
}
