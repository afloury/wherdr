import { describe, expect, it } from 'vitest'
import { initialState, onEvent, planSteps } from '../shared/pm/steps'
import type { Template } from '../shared/pm/workflow'

const t: Template = { id: 'v', taskTypes: { s: { steps: [
  { id: 'todo' }, { id: 'work', holder: 'worker', ends: 'report' }, { id: 'land', ends: 'user', userLabel: 'Land', action: { kind: 'git.land', target: 'dev' } }, { id: 'done' },
] } } }
const plan = planSteps(t, { type: 's' })

describe('Mark done (close)', () => {
  it('finishes a task waiting on a user step without running its action', () => {
    let s = onEvent(plan, initialState(), { kind: 'start' }, 0).state
    s = onEvent(plan, s, { kind: 'report', from: 'worker' }, 1).state
    expect(plan[s.at]!.id).toBe('land')
    const r = onEvent(plan, s, { kind: 'close' }, 2)
    expect(r.refused).toBeUndefined()
    expect(r.state).toMatchObject({ done: true, yourTurn: undefined })
    expect(r.state.abandoned).toBeUndefined()
    expect(r.effects.some(e => e.kind === 'action')).toBe(false)
  })
  it('refuses a task not started, done already, or running a step action', () => {
    expect(onEvent(plan, initialState(), { kind: 'close' }, 0).refused).toBe('Not started')
    const s = onEvent(plan, initialState(), { kind: 'start' }, 0).state
    expect(onEvent(plan, { ...s, acting: true }, { kind: 'close' }, 1).refused).toMatch(/running/)
    expect(onEvent(plan, { ...s, done: true }, { kind: 'close' }, 1).refused).toBe('The task is done')
  })
})
