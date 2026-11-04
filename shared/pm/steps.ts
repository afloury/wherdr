// The step engine: moves a task through the steps of its task type. Pure: it
// takes the task's step state and one event, and returns the new state plus
// the effects for the server to carry out (send a step's instructions to its
// holder, run an engine action). It knows no tool and no workflow: only who
// holds a step, how it ends, the proofs it needs and its deadline.
import type { Evidence, Holder, Step, StepAction, Template, TaskInput } from './workflow'

export interface PlannedStep extends Step { text: string } // text: what the holder is told at the start

// Why the task is in Your turn, and the badge that says what to do.
export interface YourTurn { reason: 'user' | 'timeout' | 'rounds' | 'action', badge: string }

export interface StepState {
  at: number // index of the current step
  started: boolean
  since?: number // when the current step started
  deadline?: number // absolute time, from the step's timeout
  recheckAt?: number // absolute time, for a step with recheck
  acting?: boolean // an engine action is running
  yourTurn?: YourTurn
  proofs: Record<string, Partial<Record<Evidence, string>>> // per step id
  rounds: Record<string, number> // send-backs per verdict step id
  done?: boolean
}

export type StepEvent =
  | { kind: 'start' }
  | { kind: 'report', from: Holder, evidence?: Partial<Record<Evidence, string>> }
  | { kind: 'verdict', from: Holder, pass: boolean }
  | { kind: 'user' } // the step's button, or "it is merged" said by the user
  | { kind: 'action-result', ok: boolean, error?: string }
  | { kind: 'tick' }

export type Effect =
  | { kind: 'instruct', step: string, holder: Holder, text: string }
  | { kind: 'action', step: string, action: StepAction }
  | { kind: 'done' }

export interface StepResult { state: StepState, effects: Effect[], refused?: string }

const UNIT = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const
export const durationMs = (d: string) => Number(d.slice(0, -1)) * UNIT[d.slice(-1) as keyof typeof UNIT]

const PROOF: Record<Evidence, string> = { link: 'a link', commit: 'the commit', report: 'your report', 'proposed-tasks': 'the proposed tasks' }
export const DEFAULT_ROUNDS = 2

// The steps of a task type, shared steps resolved, each with the text its
// holder gets: every level's instructions, broadest first, then the proofs.
export function planSteps(t: Template, input: TaskInput): PlannedStep[] {
  const tt = t.taskTypes[input.type]
  if (!tt) return []
  return tt.steps.map(s => (typeof s === 'string' ? t.steps![s]! : s)).map((s) => {
    const own = input.steps?.[s.id]
    const parts = [t.instructions, tt.instructions, input.instructions, s.instructions, own?.instructions].map(x => x?.trim()).filter(Boolean)
    if (s.evidence?.length) parts.push(`Before you say you are done, give ${s.evidence.map(e => PROOF[e]).join(', ')}.`)
    return { ...s, ...(own?.timeout ? { timeout: own.timeout } : {}), text: parts.join('\n\n') }
  })
}

export const initialState = (): StepState => ({ at: 0, started: false, proofs: {}, rounds: {} })
export const currentStep = (plan: PlannedStep[], s: StepState): PlannedStep | undefined => plan[s.at]
const hasAgent = (s: Step) => !!s.holder && s.holder !== 'none'

// Enters step i: a step with no end is passed through (the last one is done).
function enter(plan: PlannedStep[], prev: StepState, i: number, now: number, effects: Effect[]): StepState {
  const step = plan[i]
  const s: StepState = { ...prev, at: Math.min(i, plan.length - 1), started: true, since: now, deadline: undefined, recheckAt: undefined, acting: undefined, yourTurn: undefined }
  if (!step) return effects.push({ kind: 'done' }), { ...s, done: true }
  if (!step.ends) return i === plan.length - 1 ? (effects.push({ kind: 'done' }), { ...s, done: true }) : enter(plan, s, i + 1, now, effects)
  if (step.timeout) s.deadline = now + durationMs(step.timeout)
  if (step.recheck) s.recheckAt = now + durationMs(step.recheck)
  if (hasAgent(step)) effects.push({ kind: 'instruct', step: step.id, holder: step.holder!, text: step.text })
  if (step.ends === 'action') { s.acting = true; effects.push({ kind: 'action', step: step.id, action: step.action! }) }
  if (step.ends === 'user') s.yourTurn = { reason: 'user', badge: step.badge || step.userLabel || step.id }
  return s
}

export function onEvent(plan: PlannedStep[], state: StepState, ev: StepEvent, now: number): StepResult {
  const effects: Effect[] = []
  const refuse = (why: string): StepResult => ({ state, effects: [], refused: why })
  const next = () => ({ state: enter(plan, state, state.at + 1, now, effects), effects })
  if (state.done) return refuse('The task is done')
  const step = plan[state.at]
  if (!step) return refuse('The task has no steps')
  if (ev.kind === 'start') {
    if (state.started) return refuse('Already started')
    return { state: enter(plan, state, step.ends ? 0 : 1, now, effects), effects }
  }
  if (!state.started) return refuse('Not started')
  const fromHolder = (from: Holder) => from === step.holder

  switch (ev.kind) {
    case 'report': {
      if (step.ends !== 'report') return refuse(`Step "${step.id}" does not end with a report`)
      if (!fromHolder(ev.from)) return refuse(`Step "${step.id}" is held by the ${step.holder}`)
      const given = { ...state.proofs[step.id], ...ev.evidence }
      const proofs = { ...state.proofs, [step.id]: given }
      const missing = (step.evidence ?? []).filter(e => !given[e]?.trim())
      if (missing.length) {
        const ask = `Not done yet: step "${step.id}" needs ${missing.map(e => PROOF[e]).join(', ')}.`
        return { state: { ...state, proofs }, effects: [{ kind: 'instruct', step: step.id, holder: step.holder!, text: ask }], refused: ask }
      }
      return { state: enter(plan, { ...state, proofs }, state.at + 1, now, effects), effects }
    }
    case 'verdict': {
      if (step.ends !== 'verdict') return refuse(`Step "${step.id}" does not end with a verdict`)
      if (!fromHolder(ev.from)) return refuse(`Step "${step.id}" is held by the ${step.holder}`)
      if (ev.pass) return next()
      const n = (state.rounds[step.id] ?? 0) + 1
      const rounds = { ...state.rounds, [step.id]: n }
      const max = step.rounds ?? DEFAULT_ROUNDS
      // Past the rounds, nothing is sent back: the choice is the user's (lot 6 adds the advice).
      if (n > max) return { state: { ...state, rounds, yourTurn: { reason: 'rounds', badge: `Decide: ${step.id} failed ${n} times` } }, effects }
      return { state: enter(plan, { ...state, rounds }, plan.findIndex(p => p.id === step.sendBack), now, effects), effects }
    }
    case 'user': {
      // A failed action can be tried again by the user.
      const retry = step.ends === 'action' && !state.acting && state.yourTurn?.reason === 'action'
      if (step.ends !== 'user' && !retry) return refuse(`Step "${step.id}" does not wait for you`)
      if (state.acting) return refuse('Already checking')
      if (!step.action) return next()
      return { state: { ...state, acting: true, yourTurn: undefined }, effects: [{ kind: 'action', step: step.id, action: step.action }] }
    }
    case 'action-result': {
      if (!state.acting) return refuse('No action is running')
      if (ev.ok) return next()
      // The step stays open; the badge says what went wrong.
      const badge = `${step.badge || step.userLabel || step.id}: ${ev.error || `${step.action!.kind} failed`}`
      return { state: { ...state, acting: undefined, yourTurn: { reason: 'action', badge } }, effects }
    }
    case 'tick': {
      let s = state
      if (s.recheckAt !== undefined && now >= s.recheckAt && hasAgent(step)) {
        effects.push({ kind: 'instruct', step: step.id, holder: step.holder!, text: `Check again: ${step.text}` })
        s = { ...s, recheckAt: now + durationMs(step.recheck!) }
      }
      if (s.deadline !== undefined && now >= s.deadline && !s.yourTurn)
        s = { ...s, yourTurn: { reason: 'timeout', badge: `Check ${step.id}: over ${step.timeout}` } }
      return { state: s, effects }
    }
  }
}
