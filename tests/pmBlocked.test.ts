import { expect, it } from 'vitest'
import { github } from '../shared/pm/examples'
import { planSteps, type StepState } from '../shared/pm/steps'
import { awaitsHolder, HANDLE_AFTER_MS, IDLE_WAIT_MS, RED_CI_WAIT_MS, stallOf } from '../shared/pm/blocked'
import { cardOf, handleLabel, toHandle } from '../shared/pm/board'
import { ciOf } from '../shared/pm/mechanic'
import type { Task } from '../shared/pm/run'

// github / simple: todo, work, pr (github.pr), review, merge (github.merge), done.
const plan = planSteps(github, { type: 'simple' })
const at = (i: number, more: Partial<StepState> = {}): StepState => ({ at: i, started: true, since: 1000, proofs: {}, rounds: {}, ...more })
const task = (step: StepState, more: Partial<Task> = {}): Task =>
  ({ id: 'CO-1', project: 'CO', title: 'T', description: '', type: 'simple', state: 'working', step, createdAt: 1, ...more })

it('red CI sent to the agent stalls the task after 15 min while it stays red on that commit', () => {
  const sent = 5000, red = task(at(4), { mech: { 'base:abc': 2000, 'red:abc': sent }, ci: { head: 'abc', red: true } })
  expect(stallOf(red, plan, sent + RED_CI_WAIT_MS - 1)).toBeUndefined()
  expect(stallOf(red, plan, sent + RED_CI_WAIT_MS)).toEqual({ reason: 'CI red, no new push for 15 min', since: sent + RED_CI_WAIT_MS })
  // The fix committed or pushed, CI green, a later engine move, a new step, or already the user's: no stall.
  const late = sent + RED_CI_WAIT_MS * 2
  expect(stallOf({ ...red, ci: { head: 'def', red: false } }, plan, late)).toBeUndefined()
  expect(stallOf({ ...red, ci: { head: 'abc', red: false } }, plan, late)).toBeUndefined()
  expect(stallOf({ ...red, mech: { ...red.mech, 'catch-up:abc': sent + 1 } }, plan, late)).toBeUndefined()
  expect(stallOf({ ...red, step: at(4, { since: sent + 1 }) }, plan, late)).toBeUndefined()
  expect(stallOf({ ...red, stopped: { by: 'user', why: 'test', at: 1 } }, plan, late)).toBeUndefined()
  // What the engine reads: red only at the task's commit, once the checks finished.
  const pr = (headRefOid: string, conclusion: string, status = 'COMPLETED') => ({ url: 'u', baseRefName: 'v3', headRefOid, statusCheckRollup: [{ name: 'test', status, conclusion }] })
  expect(ciOf(pr('abc', 'FAILURE'), 'abc')).toEqual({ head: 'abc', red: true })
  expect(ciOf(pr('abc', 'FAILURE'), 'def')).toEqual({ head: 'def', red: false })
  expect(ciOf(pr('abc', '', 'IN_PROGRESS'), 'abc')).toEqual({ head: 'abc', red: false })
})

it('an idle agent whose step waits for its report stalls the task after 5 min', () => {
  const idle = task(at(1, { told: 1000 }), { idle: 3000 })
  expect(awaitsHolder(idle, plan)).toBe(true)
  expect(awaitsHolder(task(at(1)), plan)).toBe(false) // instructions not delivered yet
  expect(stallOf(idle, plan, 3000 + IDLE_WAIT_MS - 1)).toBeUndefined()
  expect(stallOf(idle, plan, 3000 + IDLE_WAIT_MS)).toEqual({ reason: 'The worker stopped before saying it is done', since: 3000 + IDLE_WAIT_MS })
  expect(stallOf({ ...idle, idle: undefined }, plan, 1e9)).toBeUndefined()
})

it('a stall shows on the card; after 30 min it is Your turn and in Tasks to handle', () => {
  const red = task(at(4, { since: 0 }), { mech: { 'red:abc': 0 }, ci: { head: 'abc', red: true } })
  const young = cardOf(red, plan, [], RED_CI_WAIT_MS)
  expect(young.stall?.reason).toBe('CI red, no new push for 15 min')
  expect(young.yourTurn).toBeUndefined()
  expect(toHandle([young])).toEqual([])
  const old = cardOf(red, plan, [], RED_CI_WAIT_MS + HANDLE_AFTER_MS)
  expect(old.yourTurn).toBe('Stalled: CI red, no new push for 15 min')
  expect(toHandle([old])).toEqual([{ id: 'CO-1', shown: 'CO-1', title: 'T', action: 'Stalled: CI red, no new push for 15 min', label: 'Unblock' }])
  // What already waits for the user is there at once, with its action.
  const merge = cardOf(task(at(4, { yourTurn: { reason: 'action', badge: 'merge: head moved' } })), plan, [])
  expect(merge.stall).toBeUndefined()
  expect(handleLabel(merge)).toBe('Retry')
  expect(handleLabel({ stopped: { by: 'user', why: 'x', at: 1 } })).toBe('Resume')
})
