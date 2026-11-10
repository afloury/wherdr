// `wherdr pm ui action resume|step|open <task>`: an agent puts a button in its
// reply; only the user's click acts (POST /api/ui/act, server/utils/uiActions.ts),
// through the same handlers as the task sheet. The list of actions is closed.
// Pure: the card, its stamp (what must still hold at the click) and its block.
import type { Task } from './pm/run'
import { stepLabels, type PlannedStep } from './pm/steps'

export const UI_ACTIONS = ['resume', 'step', 'open'] as const
export type UiAction = typeof UI_ACTIONS[number]
export const isUiAction = (v: unknown): v is UiAction => (UI_ACTIONS as readonly unknown[]).includes(v)

// open: waits for a click; done: the click ran it; stale: what it was for has
// changed (or 24 h passed); the card then runs nothing.
export type UiCardState = 'open' | 'done' | 'stale'
export interface UiCard {
  id: string, by: string, at: number, kind: UiAction, task: string, shown: string
  label: string, stamp: string, state: UiCardState, outcome?: { text: string, at: number }
}
export const UI_CARD_MS = 24 * 3600_000
export const UI_CARDS_MAX = 20

// What must still hold at the click, the same thing Decisions keys on: the same
// stop (resume), the same user step entered at the same time (step). null: the
// action has nothing to act on now. open always holds.
export function actionStamp(kind: UiAction, task: Task, plan: PlannedStep[]): string | null {
  if (kind === 'open') return `open:${task.id}`
  if (kind === 'resume') return task.stopped ? `stopped:${task.id}:${task.stopped.at}` : null
  const s = task.step, step = s ? plan[s.at] : undefined
  if (task.stopped || !s?.started || s.done || step?.ends !== 'user') return null
  return `step:${task.id}:${step.id}:${s.since ?? 0}`
}

// Why the agent may not add it now: the task's state says what each action needs.
export function actionRefusal(kind: UiAction, stamp: string | null, shown: string): string | null {
  if (stamp) return null
  return kind === 'resume' ? `${shown} is not stopped: nothing to resume` : `${shown} does not wait on a step of the user's: no button to give`
}

// The button: the step's own label ("Merge", "Approve screenshots").
export function actionLabel(kind: UiAction, shown: string, plan: PlannedStep[], task: Task): string {
  if (kind === 'resume') return `Resume ${shown}`
  if (kind === 'open') return `Open ${shown}`
  const step = plan[task.step?.at ?? -1]
  return step ? stepLabels(step).button : 'Done'
}

// The card as the click finds it: stale once its stamp no longer holds or it is
// over a day old. stampNow: the task's stamp now (null: gone or nothing to act on).
export function cardNow(card: UiCard, stampNow: string | null, now: number): UiCard {
  if (card.state !== 'open') return card
  return stampNow !== card.stamp || now - card.at > UI_CARD_MS ? { ...card, state: 'stale' } : card
}

export const outcomeText = (card: Pick<UiCard, 'kind' | 'label'>) => card.kind === 'resume' ? 'Resumed by you' : `${card.label}: done by you`

// The cards a coordinator keeps: the new one first, one per task and action
// (a new one replaces the older), the newest UI_CARDS_MAX of the last day.
export function keepCards(cards: UiCard[], card: UiCard, now: number): UiCard[] {
  const rest = cards.filter(c => !(c.task === card.task && c.kind === card.kind) && now - c.at <= UI_CARD_MS)
  return [card, ...rest].slice(0, UI_CARDS_MAX)
}

// The block the agent ends its reply with; utils/markdown.ts shows each
// `action <id>` line as the card (ActionCard.vue).
export const actionBlock = (id: string) => `\`\`\`wherdr\naction ${id}\n\`\`\``
const ACTION_LINE = /^action\s+([0-9a-f]{16})$/
export function parseActionLine(line: string): string | null {
  return ACTION_LINE.exec(line.trim())?.[1] ?? null
}
