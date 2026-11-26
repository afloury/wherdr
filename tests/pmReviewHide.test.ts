// Snooze and dismiss on Tasks to review (#1055): the user's notes on an entry,
// kept in the `reviewHidden` setting; the board's cards carry them (Card.hidden),
// the lists and counts follow, the task itself is never touched.
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'

const dir = vi.hoisted(() => {
  const d = `${process.env.TMPDIR || '/tmp'}/pm-hide-${process.pid}`
  process.env.DATA_DIR = d
  return d
})
const { createPmStore } = await import('../server/utils/pmStore')
const { board, reviewHide } = await import('../server/utils/pmBoard')
const { loadSettings } = await import('../server/utils/settings')
import { company } from '../shared/pm/examples'
import { toHandle } from '../shared/pm/board'
import { SNOOZE_MAX_MS, dismiss, hideOf, readHidden, reviewKey, show, snooze, snoozeEnd, writeHidden } from '../shared/pm/reviewHide'

afterAll(() => fs.rm(dir, { recursive: true, force: true }))

const card = (over = {}) => ({ id: 'CO-1', step: 'work', yourTurn: 'Check work: over 3h', state: { at: 1, started: true, since: 10, deadline: 20, proofs: {}, rounds: {}, yourTurn: { reason: 'timeout' as const, badge: 'Check work: over 3h' } }, ...over })

it('a snooze ends at its time; a dismissal ends when something new happens on the task', () => {
  const c = card()
  const snoozed = snooze({}, c, 5000, 1000)
  expect(hideOf(snoozed, c, 4999)).toEqual({ kind: 'snoozed', until: 5000 })
  expect(hideOf(snoozed, c, 5000)).toBeUndefined()
  const dismissed = dismiss({}, c, 1000)
  expect(hideOf(dismissed, c, 9e9)).toEqual({ kind: 'dismissed' })
  // A new timeout (its step's clock started again), a new step, a new question or block: shown again.
  expect(hideOf(dismissed, card({ state: { ...c.state, deadline: 99 } }), 1)).toBeUndefined()
  expect(hideOf(dismissed, card({ step: 'review', state: { ...c.state, at: 2, since: 50 } }), 1)).toBeUndefined()
  expect(hideOf(dismissed, card({ asks: { kind: 'question', text: 'Which one?' } }), 1)).toBeUndefined()
  expect(reviewKey(c)).toBe(reviewKey(card()))
  expect(hideOf(show(dismissed, 'CO-1'), c, 1)).toBeUndefined()
})

it('a pause that moves the deadline is nothing new; a snooze ends early on something new', () => {
  const waits = card({ yourTurn: 'Approve the plan', state: { at: 1, started: true, since: 10, deadline: 20, proofs: {}, rounds: {}, yourTurn: { reason: 'user' as const, badge: 'Approve the plan' } } })
  const dismissed = dismiss({}, waits, 1000)
  expect(hideOf(dismissed, { ...waits, state: { ...waits.state, deadline: 80 } }, 2000)).toEqual({ kind: 'dismissed' })
  const snoozed = snooze({}, waits, 5000, 1000)
  expect(hideOf(snoozed, { ...waits, state: { ...waits.state, deadline: 80 } }, 2000)).toEqual({ kind: 'snoozed', until: 5000 })
  expect(hideOf(snoozed, { ...waits, asks: { kind: 'question', text: 'Which one?' } }, 2000)).toBeUndefined()
  expect(readHidden(JSON.stringify(snoozed))).toEqual(snoozed)
})

it('keeps what is stored small and valid', () => {
  expect(readHidden('nonsense')).toEqual({})
  expect(readHidden(JSON.stringify({ a: { at: 1, until: 9 }, b: { at: 1 }, c: 'x', d: { at: 2, seen: 'k' } }))).toEqual({ a: { at: 1, until: 9 }, d: { at: 2, seen: 'k' } })
  const h = { old: { at: 1, until: 50 }, kept: { at: 2, until: 500 }, gone: { at: 3, seen: 'k' } }
  expect(JSON.parse(writeHidden(h, 100, id => id !== 'gone')!)).toEqual({ kept: { at: 2, until: 500 } })
  expect(writeHidden({ old: { at: 1, until: 50 } }, 100)).toBeNull()
  expect(snoozeEnd(100, 200)).toBeUndefined()
  expect(snoozeEnd(200 + SNOOZE_MAX_MS + 1, 200)).toBeUndefined()
  expect(snoozeEnd(3_600_200, 200)).toBe(3_600_200)
})

it('hides the entry for the user only: the card carries it, Tasks to handle and the counts leave it out, the task is unchanged', async () => {
  const store = createPmStore(path.join(dir, 'projects'))
  await store.setEnabled(true)
  await store.saveTemplate(company)
  await fs.writeFile(store.files.projects, JSON.stringify({ v: 1, projects: [{ key: 'CO', name: 'Company', machine: '', path: '/src/co', template: 'company', addedAt: 1 }] }))
  const task = await store.addTask({ project: 'CO', title: 'Fix it', type: 'feature' })
  const step = { at: 1, started: true, since: 10, proofs: {}, rounds: {}, yourTurn: { reason: 'timeout' as const, badge: 'Check work: over 3h' } }
  await store.saveTask({ ...task, state: 'working', step })
  const handled = async () => toHandle((await board(store)).cards).map(x => x.id)
  expect(await handled()).toEqual(['CO-1'])

  await reviewHide(store, { id: 'CO-1', until: Date.now() + 3_600_000 })
  expect((await board(store)).cards[0]).toMatchObject({ yourTurn: 'Check work: over 3h', hidden: { kind: 'snoozed' } })
  expect(await handled()).toEqual([])
  await reviewHide(store, { id: 'CO-1', show: true })
  expect(await handled()).toEqual(['CO-1'])

  await reviewHide(store, { id: 'CO-1', dismiss: true })
  expect(await handled()).toEqual([])
  // A new timeout on the task: back.
  await store.saveTask({ ...(await store.task('CO-1'))!, step: { ...step, deadline: 99 } })
  expect(await handled()).toEqual(['CO-1'])

  expect(await store.task('CO-1')).toMatchObject({ state: 'working', step: { yourTurn: { reason: 'timeout' } } })
  await expect(reviewHide(store, { id: 'CO-1', until: 5 })).rejects.toThrow('within a month')
  await expect(reviewHide(store, { id: 'CO-9', dismiss: true })).rejects.toThrow('No task')
  expect(Object.keys(JSON.parse((await loadSettings()).reviewHidden ?? '{}'))).toEqual(['CO-1'])
})
