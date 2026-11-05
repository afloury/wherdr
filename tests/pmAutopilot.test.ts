import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTOPILOT, autopilotEvents, coordinatorStartRefusal, sentence, cleanAutopilot, inHours, LOOK_PER_DAY, bump, limitsLeft, lookAddRefusal, nothingToDo, scheduledWake, startRefusal, today, tellRefusal } from '../shared/pm/autopilot'
import type { Run, Task } from '../shared/pm/run'

const task = (n: number, more: Partial<Task> = {}): Task => ({ id: `CO-${n}`, project: 'CO', title: `T${n}`, description: '', type: 'feature', state: 'working', createdAt: 0, ...more })
const run = (n: number, startedAt: number): Run => ({ id: `r${n}`, task: `CO-${n}`, role: 'worker', program: 'claude', model: 'opus', machine: '', worktree: '', branch: '', instructions: '', attempt: 1, state: 'running', startedAt })
const at = (h: number) => new Date(2026, 10, 5, h, 30).getTime()

describe('autopilot settings', () => {
  it('keeps what is valid and refuses the rest', () => {
    expect(cleanAutopilot({ on: true, goal: ' ship v3 ', every: '2h', events: ['done', 'done', 'stuck'], perDay: 5, atOnce: 2, hours: { from: 22, to: 6 }, extra: 1 }))
      .toEqual({ autopilot: { on: true, goal: 'ship v3', every: '2h', events: ['done', 'stuck'], perDay: 5, atOnce: 2, hours: { from: 22, to: 6 } } })
    expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, every: '0m' })).toEqual({ error: expect.stringMatching(/every/) })
    expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, at: ' daily 08:00 ' })).toMatchObject({ autopilot: { at: 'daily 08:00' } })
    for (const at of ['every 2h', 'soon']) expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, at })).toEqual({ error: expect.stringMatching(/^at:/) })
    expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, events: ['merged'] })).toEqual({ error: expect.stringMatching(/events/) })
    expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, perDay: 1000 })).toEqual({ error: expect.stringMatching(/perDay/) })
    expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, hours: { from: 8, to: 8 } })).toEqual({ error: expect.stringMatching(/hours/) })
  })

  it('hours may span midnight', () => {
    expect([at(23), at(3), at(12)].map(t => inHours({ from: 22, to: 6 }, new Date(t)))).toEqual([true, true, false])
    expect([at(9), at(18)].map(t => inHours({ from: 9, to: 18 }, new Date(t)))).toEqual([true, false])
  })
})

describe('autopilot limits', () => {
  const ap = { ...DEFAULT_AUTOPILOT, on: true, perDay: 3, atOnce: 2 }

  it('waiting and ready tasks take no slot', () => {
    const tasks = [task(1), task(2, { state: 'waiting', waiting: 'a question' }), task(3, { step: { at: 1, started: true, proofs: {}, rounds: {}, yourTurn: { reason: 'user', badge: 'Merge' } } })]
    expect(limitsLeft(ap, tasks, [], at(12))).toMatchObject({ working: 1, startLeft: 1 })
    expect(startRefusal(ap, tasks, [], at(12))).toBeUndefined()
    expect(startRefusal(ap, [...tasks, task(4)], [], at(12))).toMatch(/2 tasks already work at once/)
  })

  it('counts the tasks started since midnight, a task once', () => {
    const tasks = [1, 2, 3].map(n => task(n, { state: 'waiting' }))
    const runs = [run(1, at(1)), run(1, at(2)), run(2, at(3)), run(3, at(3) - 86_400_000)]
    expect(limitsLeft(ap, tasks, runs, at(12))).toMatchObject({ started: 2, startLeft: 1 })
    // A task first started yesterday does not count today.
    expect(startRefusal(ap, [...tasks, task(4, { state: 'waiting' })], [...runs, run(3, at(4)), run(4, at(4))], at(12))).toMatch(/Today's limit is reached \(3/)
    expect(startRefusal({ ...ap, hours: { from: 22, to: 6 } }, [], [], at(12))).toMatch(/hours/)
  })
})

describe('autopilot events', () => {
  it('wakes for the events it was given, once per change', () => {
    const ap = { ...DEFAULT_AUTOPILOT, events: ['added', 'stuck'] as const }
    const seen = { 'CO-1': 'working', 'CO-2': 'working' } as const
    const tasks = [task(1, { state: 'waiting', waiting: 'Which DB?\nmore' }), task(2, { step: { at: 3, started: true, done: true, proofs: {}, rounds: {} } }), task(3, { state: 'todo' })]
    const r = autopilotEvents({ ...ap, events: [...ap.events] }, tasks, seen)
    expect(r.reasons).toEqual(['CO-1 (T1): stuck: Which DB?', 'CO-3 (T3): added'])
    expect(r.seen).toEqual({ 'CO-1': 'waiting', 'CO-2': 'done', 'CO-3': 'todo' })
    expect(autopilotEvents({ ...ap, events: [...ap.events] }, tasks, r.seen).reasons).toEqual([])
  })
})

describe('nothing to do: scheduled wakes skipped', () => {
  const done = (n: number) => task(n, { step: { at: 3, started: true, done: true, proofs: {}, rounds: {} } })
  const last = { at: 100, seen: { 'CO-1': 'done', 'CO-2': 'done' } } as const
  const wake = { ...last, seen: { ...last.seen } }
  it('only when every task is done and nothing changed since the last wake', () => {
    expect(nothingToDo([done(1), done(2)], wake)).toBe(true)
    expect(nothingToDo([], { at: 1, seen: {} })).toBe(true)
    // Never known before a first wake.
    expect(nothingToDo([done(1)], {})).toBe(false)
    // Under way, to do, waiting for the user or ready for them.
    for (const t of [task(2), task(2, { state: 'todo' }), task(2, { state: 'waiting' }), task(2, { step: { at: 3, started: true, proofs: {}, rounds: {}, yourTurn: { reason: 'user', badge: 'Merge' } } })])
      expect(nothingToDo([done(1), t], wake)).toBe(false)
    // A change since: a task finished, added or removed, a message of the user.
    expect(nothingToDo([done(1), done(2)], { at: 100, seen: { 'CO-1': 'done', 'CO-2': 'working' } })).toBe(false)
    expect(nothingToDo([done(1), done(2), done(3)], wake)).toBe(false)
    expect(nothingToDo([done(1)], wake)).toBe(false)
    expect(nothingToDo([done(1), done(2)], wake, 101)).toBe(false)
    expect(nothingToDo([done(1), done(2)], wake, 99)).toBe(true)
  })
  it('kept with "look for new work", within the tasks those wakes may add a day', () => {
    const idle = [done(1), done(2)]
    expect(scheduledWake(DEFAULT_AUTOPILOT, idle, wake, undefined, 0)).toBe('idle')
    expect(scheduledWake(DEFAULT_AUTOPILOT, [done(1), task(2)], wake, undefined, 0)).toBe('send')
    const look = { ...DEFAULT_AUTOPILOT, lookForWork: true as const }
    expect(scheduledWake(look, idle, wake, undefined, LOOK_PER_DAY - 1)).toBe('look')
    expect(scheduledWake(look, idle, wake, undefined, LOOK_PER_DAY)).toBe('limit')
    expect(scheduledWake({ ...look, lookPerDay: 5 }, idle, wake, undefined, 4)).toBe('look')
    expect(scheduledWake({ ...look, lookPerDay: 0 }, idle, wake, undefined, 0)).toBe('limit')
    // Work to do is never limited by it.
    expect(scheduledWake(look, [task(1)], wake, undefined, 99)).toBe('send')
    expect(lookAddRefusal(look, 2)).toBeUndefined()
    expect(lookAddRefusal(look, 3)).toMatch(/limit of new work is reached \(3 tasks.*until tomorrow/)
    // The settings: on by default at 3 a day, editable, kept only with the option on.
    expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, lookForWork: true })).toEqual({ autopilot: { ...DEFAULT_AUTOPILOT, lookForWork: true, lookPerDay: 3 } })
    expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, lookForWork: true, lookPerDay: 7 })).toEqual({ autopilot: { ...DEFAULT_AUTOPILOT, lookForWork: true, lookPerDay: 7 } })
    expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, lookForWork: true, lookPerDay: 21 })).toEqual({ error: expect.stringMatching(/^lookPerDay/) })
    expect(cleanAutopilot({ ...DEFAULT_AUTOPILOT, lookForWork: 'yes', lookPerDay: 7 })).toEqual({ autopilot: DEFAULT_AUTOPILOT })
  })
  it('counts per local day', () => {
    const c = { day: new Date(at(9)).toDateString(), n: 3 }
    expect(today(c, at(23))).toBe(3)
    expect(today(c, at(9) + 86_400_000)).toBe(0)
    expect(today(undefined, at(9))).toBe(0)
    expect(bump(c, at(10))).toEqual({ ...c, n: 4 })
    expect(bump(c, at(9) + 86_400_000)).toEqual({ day: new Date(at(9) + 86_400_000).toDateString(), n: 1 })
  })
})

describe('tell', () => {
  it('in a wake, only answers a question; a permission is always the user\'s', () => {
    expect(tellRefusal({ state: 'waiting', waitKind: 'question' }, true)).toBeUndefined()
    expect(tellRefusal({ state: 'working' }, true)).toMatch(/only answers an agent's question/)
    expect(tellRefusal({ state: 'working' }, false)).toBeUndefined()
    expect(tellRefusal({ state: 'waiting', waitKind: 'permission' }, false)).toMatch(/permission request is the user's/)
  })
})

describe('starting a task (coordinator, or the engine for a chained one)', () => {
  const ap = { ...DEFAULT_AUTOPILOT, on: true, perDay: 2, atOnce: 1 }
  const todo = (n: number, more: Partial<Task> = {}) => task(n, { state: 'todo', ...more })
  const done = task(1, { step: { at: 3, started: true, done: true, proofs: {}, rounds: {} } })

  it('in a wake only with the autopilot on, within its limits; a user turn keeps the limits', () => {
    expect(coordinatorStartRefusal(ap, todo(2), [todo(2)], [], at(12), true)).toBeUndefined()
    expect(coordinatorStartRefusal({ ...ap, on: false }, todo(2), [todo(2)], [], at(12), true)).toBe('In a wake, a task starts only with the autopilot on')
    expect(coordinatorStartRefusal({ ...ap, on: false }, todo(2), [todo(2)], [], at(12), false)).toBeUndefined()
    expect(coordinatorStartRefusal(ap, todo(2), [task(3), todo(2)], [], at(12), false)).toMatch(/already work at once/)
    const finished = (n: number) => task(n, { step: { at: 3, started: true, done: true, proofs: {}, rounds: {} } })
    expect(coordinatorStartRefusal(ap, todo(2), [todo(2), finished(4), finished(5)], [run(4, at(9)), run(5, at(10))], at(12), true)).toMatch(/Today's limit/)
    expect(coordinatorStartRefusal({ ...ap, hours: { from: 22, to: 6 } }, todo(2), [todo(2)], [], at(12), true)).toBe('Outside the autopilot\'s hours')
    expect(coordinatorStartRefusal(ap, task(2), [task(2)], [], at(12), false)).toBe('CO-2 is not to do (working)')
    // Stopped on a failure: started again, in a wake only while it ran few times; a question is not a stop.
    const stopped = task(2, { state: 'waiting', waiting: 'git worktree failed' })
    expect(coordinatorStartRefusal(ap, stopped, [stopped], [run(2, at(9))], at(12), true)).toBeUndefined()
    // An agent that exited at once: its second attempt is the same start.
    expect(coordinatorStartRefusal(ap, stopped, [stopped], [run(2, at(9)), { ...run(2, at(9)), id: 'r2b', attempt: 2 }], at(12), true)).toBeUndefined()
    expect(coordinatorStartRefusal(ap, stopped, [stopped], [run(2, at(9)), run(2, at(10))], at(12), true)).toBe('CO-2 already ran 2 times: starting it again is the user\'s call')
    expect(coordinatorStartRefusal(ap, stopped, [stopped], [run(2, at(9)), run(2, at(10))], at(12), false)).toBeUndefined()
    expect(coordinatorStartRefusal(ap, { ...stopped, waitKind: 'question' }, [stopped], [], at(12), false)).toBe('CO-2 is not to do (waiting)')
  })

  it('a chained task waits until the task before it is done', () => {
    const next = todo(2, { after: 'CO-1' })
    expect(coordinatorStartRefusal(ap, next, [task(1, { state: 'todo' }), next], [], at(12), true)).toBe('CO-2 starts after CO-1, which is not done')
    expect(coordinatorStartRefusal(ap, next, [done, next], [], at(12), true)).toBeUndefined()
  })
})

it('puts the goal in a wake with one final period', () => {
  expect(['Ship v3', 'Ship v3.', ' Ship v3? '].map(sentence)).toEqual(['Ship v3.', 'Ship v3.', 'Ship v3?'])
})
