import { expect, it } from 'vitest'
import { github } from '../shared/pm/examples'
import { planSteps, type StepState } from '../shared/pm/steps'
import { stallOf, IDLE_WAIT_MS } from '../shared/pm/blocked'
import { cardOf, toHandle } from '../shared/pm/board'
import { needsHumanDue, parseNeedsHuman } from '../shared/pm/needsHuman'
import type { Task } from '../shared/pm/run'
import { needsHumanTick } from '../server/utils/pmNeedsHuman'

const plan = planSteps(github, { type: 'simple' })
const at = (i: number): StepState => ({ at: i, started: true, since: 1000, proofs: {}, rounds: {} })
const task = (more: Partial<Task> = {}): Task =>
  ({ id: 'CO-1', project: 'CO', title: 'T', description: '', type: 'simple', state: 'working', step: at(1), createdAt: 1, ...more })
const MIN = 60_000

it('reads the kind and url a worker says, and clear', () => {
  expect(parseNeedsHuman('needs-human: passkey https://example.com/login')).toEqual({ kind: 'passkey', url: 'https://example.com/login' })
  expect(parseNeedsHuman('needs-human: 2fa')).toEqual({ kind: '2fa' })
  expect(parseNeedsHuman('needs-human: clear')).toBe('clear')
  expect(parseNeedsHuman('needs-human:')).toBeUndefined()
})

it('is due at once, again 5 and 15 min after the first, then never', () => {
  const n = (pushed: number) => ({ kind: 'login', at: 1000, pushed })
  expect([0, 5 * MIN - 1].map(d => needsHumanDue(n(0), 1000 + d))).toEqual([true, true])
  expect([needsHumanDue(n(1), 1000 + 5 * MIN - 1), needsHumanDue(n(1), 1000 + 5 * MIN)]).toEqual([false, true])
  expect([needsHumanDue(n(2), 1000 + 15 * MIN - 1), needsHumanDue(n(2), 1000 + 15 * MIN)]).toEqual([false, true])
  expect(needsHumanDue(n(3), 1000 + 99 * MIN)).toBe(false)
})

it('puts the task in the user\'s turn with a Needs you now row, until it is done or stopped', () => {
  const t = task({ needsHuman: { kind: 'login', url: 'https://example.com/login', at: 5, pushed: 1, step: 1 } })
  const card = cardOf(t, plan, [])
  expect(card.yourTurn).toBe('Needs you now: login https://example.com/login')
  expect(toHandle([card])[0]!.needsHuman).toEqual({ kind: 'login', url: 'https://example.com/login', at: 5 })
  expect(cardOf({ ...t, stopped: { by: 'user', why: 'x', at: 1 } }, plan, []).needsHuman).toBeUndefined()
  expect(cardOf({ ...t, step: { ...at(5), done: true } }, plan, []).needsHuman).toBeUndefined()
})

it('pushes the user each time it is due, once per slot, and drops a finished task\'s ask', async () => {
  const saved = new Map<string, Task>()
  const all = [task({ needsHuman: { kind: 'login', at: 0, pushed: 0, step: 1 } }), task({ id: 'CO-2', needsHuman: { kind: 'pay', at: 0, pushed: 0, step: 5 }, step: { ...at(5), done: true } })]
  const store = {
    projects: async () => [], tasks: async () => all.map(t => saved.get(t.id) ?? t),
    saveTask: async (t: Task) => { saved.set(t.id, t); return t }, logTask: async (t: Task) => { saved.set(t.id, t); return t },
  }
  const sent: string[] = []
  const notify = async (t: Task, n: { pushed: number }, _s: string, again: boolean) => { sent.push(`${t.id}:${n.pushed}:${again}`); return 1 }
  const run = (now: number) => needsHumanTick(store as never, now, notify as never)
  await run(0); await run(MIN); await run(5 * MIN); await run(15 * MIN); await run(60 * MIN)
  expect(sent).toEqual(['CO-1:0:false', 'CO-1:1:true', 'CO-1:2:true'])
  expect(saved.get('CO-2')!.needsHuman).toBeUndefined()
})

it('is not the step\'s stall: a task that waits for the person is left alone like a parked one', () => {
  const t = task({ idle: 0, step: { ...at(1), told: 1000 } })
  const late = 1000 + IDLE_WAIT_MS + 1
  expect(stallOf(t, plan, late)).toBeDefined()
  expect(stallOf({ ...t, needsHuman: { kind: 'login', at: 5, pushed: 1, step: 1 } }, plan, late)).toBeUndefined()
})

it('ends with its step: the card and the tick drop an ask said in an earlier step', async () => {
  const t = task({ step: at(2), needsHuman: { kind: 'login', at: 5, pushed: 1, step: 1 } })
  const card = cardOf(t, plan, [])
  expect(card.needsHuman).toBeUndefined()
  expect(card.yourTurn).toBeUndefined()
  const saved = new Map<string, Task>()
  const store = { projects: async () => [], tasks: async () => [t], saveTask: async (x: Task) => x, logTask: async (x: Task) => { saved.set(x.id, x); return x } }
  await needsHumanTick(store as never, 99 * MIN, (async () => 1) as never)
  expect(saved.get('CO-1')!.needsHuman).toBeUndefined()
})
