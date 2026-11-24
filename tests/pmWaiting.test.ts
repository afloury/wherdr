// Waiting for you, one rule everywhere: Tasks to review, Home's card, the board's To review and the coordinators' "n waiting for you" count the same tasks; a task whose agent
// works is working, not waiting, and its step is never touched.
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'

const dir = vi.hoisted(() => {
  const d = `${process.env.TMPDIR || '/tmp'}/pm-waiting-${process.pid}`
  process.env.DATA_DIR = d
  return d
})
const { createPmStore } = await import('../server/utils/pmStore')
const { board, countedCards, reviewHide } = await import('../server/utils/pmBoard')
import { company } from '../shared/pm/examples'
import { toHandle, waitsOnYou } from '../shared/pm/board'
import { liveCounts, workspaceView } from '../shared/pm/coordinator'
import type { Project } from '../shared/pm/project'

afterAll(() => fs.rm(dir, { recursive: true, force: true }))

const turn = { at: 1, started: true, since: 10, proofs: {}, rounds: {}, yourTurn: { reason: 'timeout' as const, badge: 'Check work: over 3h' } }

async function setup() {
  const store = createPmStore(path.join(dir, `projects-${Math.random().toString(36).slice(2)}`))
  await store.setEnabled(true)
  await store.saveTemplate(company)
  await fs.writeFile(store.files.projects, JSON.stringify({ v: 1, projects: [
    { key: 'WS', name: 'Space', machine: '', path: '/src/ws', template: 'company', kind: 'workspace', addedAt: 1 },
    { key: 'CO', name: 'Company', machine: '', path: '/src/co', template: 'company', workspace: 'WS', addedAt: 1 },
  ] }))
  for (const title of ['One', 'Two', 'Three']) {
    const t = await store.addTask({ project: 'CO', title, type: 'feature' })
    await store.saveTask({ ...t, state: 'working', step: turn })
  }
  return store
}
const rowOf = async (store: Awaited<ReturnType<typeof setup>>) => workspaceView({ key: 'WS' }, await store.projects() as Project[], await store.tasks(), await countedCards(store))

it('the coordinator row, Home and the board count the same tasks, a dismissed or snoozed one in none', async () => {
  const store = await setup()
  const handled = async () => toHandle((await board(store)).cards).map(x => x.id)
  expect(await handled()).toEqual(['CO-1', 'CO-2', 'CO-3'])
  expect((await rowOf(store)).waiting).toEqual(['CO-1', 'CO-2', 'CO-3'])

  await reviewHide(store, { id: 'CO-2', dismiss: true })
  await reviewHide(store, { id: 'CO-3', until: Date.now() + 3_600_000 })
  expect(await handled()).toEqual(['CO-1'])
  const row = await rowOf(store)
  expect(row.waiting).toEqual(['CO-1'])
  expect(row.members[0]!.waiting).toEqual(['CO-1'])
  // The board's own count (the client's reviewWaits) is the same rule over the same cards.
  expect((await board(store)).cards.filter(c => waitsOnYou(c)).map(c => c.id)).toEqual(['CO-1'])
  for (const id of ['CO-2', 'CO-3']) await reviewHide(store, { id, show: true }) // the setting is shared by the file's tests
})

it('a waiting task whose agent works is working until its agent is idle; its step is untouched', async () => {
  const store = await setup()
  const row = await rowOf(store)
  const working = (id: string) => id === 'CO-1'
  expect(liveCounts(row, working)).toEqual({ working: 1, waiting: ['CO-2', 'CO-3'] })
  expect(liveCounts(row, () => false)).toEqual({ working: 0, waiting: ['CO-1', 'CO-2', 'CO-3'] })
  const cards = (await board(store)).cards
  expect(cards.filter(c => waitsOnYou(c, working)).map(c => c.id)).toEqual(['CO-2', 'CO-3'])
  // Only the reading changes: the task keeps its step and its turn.
  expect(await store.task('CO-1')).toMatchObject({ state: 'working', step: { yourTurn: { reason: 'timeout' } } })
  expect(cards[0]!.yourTurn).toBe('Check work: over 3h')
})

it('a done or hidden card never waits, whatever its agent does', () => {
  const c = { id: 'A-1', yourTurn: 'Merge' }
  expect(waitsOnYou(c)).toBe(true)
  expect(waitsOnYou({ ...c, hidden: { kind: 'dismissed' } })).toBe(false)
  expect(waitsOnYou({ ...c, state: { done: true } as never })).toBe(false)
  expect(waitsOnYou({ id: 'A-1' })).toBe(false)
})
