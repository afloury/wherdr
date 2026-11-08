import { expect, it } from 'vitest'
import { github } from '../shared/pm/examples'
import { planSteps, type StepState } from '../shared/pm/steps'
import { awaitsHolder, blockedOf, markOfTerminal, RED_CI_WAIT_MS, taskMark } from '../shared/pm/blocked'
import { taskGroup } from '../shared/spaces'
import { ciOf } from '../shared/pm/mechanic'
import type { Task } from '../shared/pm/run'

// github / simple: todo, work, pr (github.pr), review, merge (github.merge), done.
const plan = planSteps(github, { type: 'simple' })
const at = (i: number, more: Partial<StepState> = {}): StepState => ({ at: i, started: true, since: 1000, proofs: {}, rounds: {}, ...more })
const task = (step: StepState, more: Partial<Task> = {}): Task =>
  ({ id: 'CO-1', project: 'CO', title: 'T', description: '', type: 'simple', state: 'working', step, createdAt: 1, ...more })
const failed = (i: number, error: string, tries = 1) => at(i, { yourTurn: { reason: 'action', badge: `${plan[i]!.id}: ${error}` }, tries: { [plan[i]!.id]: tries } })

it('a refused merge blocks at once; another action only once it failed again and again', () => {
  expect(blockedOf(task(failed(4, 'head moved')), plan, 0)).toBe('Merge refused: head moved')
  expect(blockedOf(task(failed(2, 'push rejected')), plan, 0)).toBeUndefined()
  expect(blockedOf(task(failed(2, 'push rejected', 3)), plan, 0)).toBe('pr failed 3 times: push rejected')
  // Stopped or waiting for an answer: the user knows already.
  expect(blockedOf(task(failed(4, 'head moved'), { stopped: { by: 'user', why: 'test', at: 1 } }), plan, 0)).toBeUndefined()
  expect(blockedOf(task(failed(4, 'head moved'), { state: 'waiting' }), plan, 0)).toBeUndefined()
})

it('red CI sent to the agent blocks after 15 min while it stays red on that commit', () => {
  const sent = 5000, red = task(at(4), { mech: { 'base:abc': 2000, 'red:abc': sent }, ci: { head: 'abc', red: true } })
  expect(blockedOf(red, plan, sent + RED_CI_WAIT_MS - 1)).toBeUndefined()
  expect(blockedOf(red, plan, sent + RED_CI_WAIT_MS)).toBe('CI red, no new push for 15 min')
  // The fix committed or pushed (another head), or CI green again: no longer blocked, even
  // when the engine records no move (a merge step that is the user's).
  expect(blockedOf({ ...red, ci: { head: 'def', red: false } }, plan, sent + RED_CI_WAIT_MS * 2)).toBeUndefined()
  expect(blockedOf({ ...red, ci: { head: 'abc', red: false } }, plan, sent + RED_CI_WAIT_MS * 2)).toBeUndefined()
  // What the engine reads: red only at the task's commit, once the checks finished.
  const pr = (headRefOid: string, conclusion: string, status = 'COMPLETED') => ({ url: 'u', baseRefName: 'v3', headRefOid, statusCheckRollup: [{ name: 'test', status, conclusion }] })
  expect(ciOf(pr('abc', 'FAILURE'), 'abc')).toEqual({ head: 'abc', red: true })
  expect(ciOf(pr('abc', 'FAILURE'), 'def')).toEqual({ head: 'def', red: false })
  expect(ciOf(pr('abc', '', 'IN_PROGRESS'), 'abc')).toEqual({ head: 'abc', red: false })
  expect(ciOf(pr('abc', 'SUCCESS'), 'abc')).toEqual({ head: 'abc', red: false })
  // A later engine move (caught up after a push) or a new step: not blocked.
  expect(blockedOf({ ...red, mech: { ...red.mech, 'catch-up:def': sent + 1 } }, plan, sent + RED_CI_WAIT_MS * 2)).toBeUndefined()
  expect(blockedOf({ ...red, step: at(4, { since: sent + 1 }) }, plan, sent + RED_CI_WAIT_MS * 2)).toBeUndefined()
})

it('an idle agent whose step waits for it blocks the task; its own question stays Your turn', () => {
  const waits = task(at(1, { told: 1000 }))
  expect(awaitsHolder(waits, plan)).toBe(true)
  expect(awaitsHolder(task(at(1)), plan)).toBe(false) // not delivered yet
  expect(awaitsHolder(task(at(4, { told: 1000 })), plan)).toBe(false) // an engine step
  const card = { holder: 'worker' as const, awaits: true as const }
  expect(taskMark(card, 'working')).toBeUndefined()
  expect(taskMark(card, 'idle')).toEqual({ kind: 'blocked', reason: 'Worker stopped before saying it is done' })
  expect(taskMark({ holder: 'none', yourTurn: 'Merge' }, null)).toEqual({ kind: 'your-turn', reason: 'Merge' })
  // The worker's and the reviewer's rows both take the task's state, from the holder's status.
  const tasks = [{ id: 'CO-1', ...card, holder: 'reviewer' as const, terminal: 'r1', terminals: ['w1', 'r1'] }]
  const status = (t: string) => (t === 'r1' ? 'done' : 'working')
  expect(markOfTerminal(tasks, 'w1', status)?.reason).toBe('Reviewer stopped before saying it is done')
  expect(markOfTerminal(tasks, 'x9', status)).toBeUndefined()
  expect(taskGroup('ready', { kind: 'blocked' })).toBe('stuck')
  expect(taskGroup('working', { kind: 'your-turn' })).toBe('blocked')
  expect(taskGroup('blocked', { kind: 'blocked' })).toBe('blocked')
})
