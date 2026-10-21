// A menu left open on the agent's screen (Claude's /status opened in its
// terminal during a turn) hides the input field held messages wait for: the
// conversation says so, and Close / Send anyway close it with one Escape.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { HOLD_AGENTS, type QueueEntry, lookForLeftMenu, nextHeld } from '../server/utils/queued'
import { inputVisible } from '../server/utils/choices'
import { HerdrError } from '../server/utils/herdr'
import { bindFunction } from './stateFunction'
import type { Pane, QueuedMessage } from '../shared/types'

const pane = (more: Partial<Pane> = {}): Pane => ({ id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'working', title: null, cwd: '/tmp/demo', agentSession: null, ...more })
const held = (more: Partial<QueuedMessage> = {}): QueuedMessage => ({ id: 'a', text: 'hello', at: 1, state: 'held', ...more })

describe('lookForLeftMenu', () => {
  it('looks while messages wait for the input field and no card explains why', () => {
    expect(lookForLeftMenu(pane({ queued: [held({ reason: 'turn' })] }))).toBe(true)
    expect(lookForLeftMenu(pane({ status: 'idle', queued: [held()] }))).toBe(true)
    expect(lookForLeftMenu(pane({ status: 'done', queued: [held({ state: 'failed', reason: 'no_input' })] }))).toBe(true)
  })
  it('does not look when nothing waits for the field, or when a card already shows the screen', () => {
    expect(lookForLeftMenu(pane())).toBe(false)
    expect(lookForLeftMenu(pane({ queued: [{ id: 'a', text: 'hello' }] }))).toBe(false)
    expect(lookForLeftMenu(pane({ queued: [held({ reason: 'busy' })] }))).toBe(false)
    expect(lookForLeftMenu(pane({ queued: [held({ state: 'failed' })] }))).toBe(false)
    expect(lookForLeftMenu(pane({ status: 'idle', queued: [held()], menu: { title: 'Resume', lines: [], items: [], cursor: null, search: null, actions: [], more: null } }))).toBe(false)
    expect(lookForLeftMenu(pane({ status: 'blocked', queued: [held()] }))).toBe(false)
    expect(lookForLeftMenu(pane({ agent: 'gemini', queued: [held()] }))).toBe(false)
    expect(lookForLeftMenu(pane({ stopped: { reason: 'update' }, queued: [held()] }))).toBe(false)
  })
})

// Claude's screen during a turn, with and without /status drawn over its field.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8')
const STATUS = fixture('claude-settings-status')
const FIELD = fixture('claude-working')

describe('closeLeftMenu', () => {
  it('reads /status as hiding the field, and a working screen as showing it', () => {
    expect(inputVisible(STATUS)).toBe(false)
    expect(inputVisible(FIELD)).toBe(true)
  })

  const source = readFileSync(new URL('../server/utils/state.ts', import.meta.url), 'utf8').replace('export async function closeLeftMenu', 'async function closeLeftMenu')
  function setup(screens: string[], list: QueueEntry[]) {
    const keys: string[][] = []
    const typed: string[] = []
    let screen = screens.shift()!
    const queued = new Map([['w1:p1', list]])
    const herdr = vi.fn(async (method: string, params: { keys?: string[] }) => {
      if (method === 'pane.send_input') { keys.push(params.keys!); if (screens.length) screen = screens.shift()!; return {} }
      return { read: { text: screen } }
    })
    const close = bindFunction(source, 'closeLeftMenu', {
      findPane: () => pane(), HOLD_AGENTS, restarting: () => false, HerdrError, herdr, inputVisible, sleep: async () => {},
      withPaneLock: (_: string, fn: () => Promise<unknown>) => fn(), log: () => {}, queued, deliverBusy: new Set(), nextHeld, poll: () => {}, setTimeout: () => 0,
      retryQueued: (_: string, id: string) => { const q = list.find(x => x.id === id)!; q.failed = false; q.held = true; delete q.noInput },
      typeHeld: async (_: Pane, q: QueueEntry) => { typed.push(q.text); q.held = false; return true },
      heldFailed: () => {},
    }) as (id: string, send: boolean) => Promise<{ closed: boolean, sent: number }>
    return { close, keys, typed }
  }

  it('closes the menu with a single Escape and puts messages not sent for lack of the field back in line', async () => {
    const lost: QueueEntry = { id: 'b', text: 'second', at: 2, failed: true, noInput: true }
    const t = setup([STATUS, FIELD], [{ id: 'a', text: 'first', at: 1, held: true, turn: true }, lost])
    expect(await t.close('w1:p1', false)).toEqual({ closed: true, sent: 0 })
    expect(t.keys).toEqual([['esc']])
    expect(lost).toMatchObject({ held: true, failed: false })
    expect(t.typed).toEqual([])
  })

  it('never presses Escape once the input field is back (it would interrupt the turn)', async () => {
    const t = setup([FIELD], [{ id: 'a', text: 'first', at: 1, held: true, turn: true }])
    expect(await t.close('w1:p1', false)).toEqual({ closed: false, sent: 0 })
    expect(t.keys).toEqual([])
  })

  it('Send anyway types the held messages at once, in order', async () => {
    const t = setup([STATUS, FIELD], [{ id: 'a', text: 'first', at: 1, held: true, turn: true }, { id: 'b', text: 'second', at: 2, held: true, turn: true }])
    expect(await t.close('w1:p1', true)).toEqual({ closed: true, sent: 2 })
    expect(t.typed).toEqual(['first', 'second'])
  })

  it('reports a menu that Escape did not close, and sends nothing', async () => {
    const t = setup([STATUS, STATUS], [{ id: 'a', text: 'first', at: 1, held: true }])
    await expect(t.close('w1:p1', true)).rejects.toMatchObject({ code: 'menu_open' })
    expect(t.keys).toEqual([['esc']])
    expect(t.typed).toEqual([])
  })
})
