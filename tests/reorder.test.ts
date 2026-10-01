import { describe, expect, it } from 'vitest'
import { applyMove, readyLists, reorderTarget, reorderWorkspaces, sortReady } from '../shared/spaces'
import type { Row } from '../shared/spaces'

// Herdr order of the machine: w1..w6. Group shown as "Ready": w2, w4, w5
// (w1, w3, w6 are in other groups).
const ORDER = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']
const GROUP = ['w2', 'w4', 'w5']

const row = (key: string, status: 'done' | 'idle'): Row => ({
  kind: 'pane', key, pane: { id: key, agent: 'claude', status } as Row['lead'],
  lead: { id: key, agent: 'claude', status } as Row['lead'],
})

describe('readyLists', () => {
  const rows = [row('w2', 'idle'), row('w4', 'done'), row('w5', 'idle'), row('w6', 'done')]

  it('puts unread first, keeping Herdr\'s order in each subgroup', () => {
    expect(readyLists(rows, true).map(list => list.map(r => r.key))).toEqual([['w4', 'w6'], ['w2', 'w5']])
  })

  it('leaves Herdr\'s order when the setting is off', () => {
    expect(readyLists(rows, false).map(list => list.map(r => r.key))).toEqual([['w2', 'w4', 'w5', 'w6']])
  })

  it('considers a space containing a finished pane unread', () => {
    const space = { kind: 'space', key: 'space', lead: row('lead', 'idle').lead,
      panes: [row('read', 'idle').lead, row('unread', 'done').lead] } as Row
    expect(readyLists([rows[0]!, space], true).map(list => list.map(r => r.key))).toEqual([['space'], ['w2']])
  })

  it('creates no empty subgroup', () => {
    expect(readyLists([row('w2', 'idle')], true).map(list => list.map(r => r.key))).toEqual([['w2']])
  })
})

describe('applyMove', () => {
  it('places before a space, or at the end', () => {
    expect(applyMove(ORDER, 'w5', 'w2')).toEqual(['w1', 'w5', 'w2', 'w3', 'w4', 'w6'])
    expect(applyMove(ORDER, 'w1', null)).toEqual(['w2', 'w3', 'w4', 'w5', 'w6', 'w1'])
    expect(applyMove(ORDER, 'w1', 'w9')).toEqual(['w2', 'w3', 'w4', 'w5', 'w6', 'w1'])
  })
})

describe('reorderTarget', () => {
  it('bounds the drop to the active subgroup and applies the usual Herdr placement', () => {
    const order = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']
    const unread = ['w2', 'w4']
    const read = ['w3', 'w5']
    expect(reorderTarget(order, unread, 'w4', 0)).toEqual({ before: 'w2' })
    expect(reorderTarget(order, read, 'w3', 2)).toEqual({ before: 'w6' })
    expect(reorderTarget(order, unread, 'w3', 1)).toBeNull()
  })
  it('at the top of the group: just before the first card', () => {
    expect(reorderTarget(ORDER, GROUP, 'w5', 0)).toEqual({ before: 'w2' })
  })

  it('entre deux cartes : avant celle du dessous, en descendant comme en montant', () => {
    expect(reorderTarget(ORDER, GROUP, 'w2', 2)).toEqual({ before: 'w5' })
    expect(reorderTarget(ORDER, GROUP, 'w5', 1)).toEqual({ before: 'w4' })
  })

  it('at the bottom of the group: just after the last one (before the space that follows it in Herdr)', () => {
    expect(reorderTarget(ORDER, GROUP, 'w2', 3)).toEqual({ before: 'w6' })
    expect(reorderTarget(ORDER, ['w2', 'w6'], 'w2', 2)).toEqual({ before: null })
  })

  it('nothing when the card stays in place', () => {
    expect(reorderTarget(ORDER, GROUP, 'w4', 1)).toBeNull()
    expect(reorderTarget(ORDER, GROUP, 'w4', 2)).toBeNull()
    expect(reorderTarget(ORDER, ['w2'], 'w2', 0)).toBeNull()
    expect(reorderTarget(ORDER, GROUP, 'w9', 0)).toBeNull()
  })

  it('spaces of the other groups keep their relative order', () => {
    const t = reorderTarget(ORDER, GROUP, 'w5', 0)!
    const next = applyMove(ORDER, 'w5', t.before)
    expect(next.filter(id => !GROUP.includes(id))).toEqual(['w1', 'w3', 'w6'])
    expect(next.filter(id => GROUP.includes(id))).toEqual(['w5', 'w2', 'w4'])
  })
})

describe('reorderWorkspaces', () => {
  it('renumbers only the space\'s machine', () => {
    const R = 'abcd1234'
    const list = [
      { id: 'w1', number: 1 }, { id: 'w2', number: 2 }, { id: 'w3', number: 3 },
      { id: `${R}~w1`, machine: R, number: 1 }, { id: `${R}~w2`, machine: R, number: 2 },
    ]
    const out = reorderWorkspaces(list, 'w3', 'w1')
    expect(out.map(w => [w.id, w.number])).toEqual([['w1', 2], ['w2', 3], ['w3', 1], [`${R}~w1`, 1], [`${R}~w2`, 2]])
    expect(reorderWorkspaces(list, `${R}~w1`, null).filter(w => w.machine).map(w => w.number)).toEqual([2, 1])
    expect(reorderWorkspaces(list, 'w9', null)).toBe(list)
  })
})

describe('sortReady', () => {
  const r = (key: string, seq?: number): Row => ({ kind: 'pane', key, pane: { id: key, agent: 'claude', status: 'idle', stateSeq: seq } as Row['lead'], lead: { id: key, agent: 'claude', status: 'idle', stateSeq: seq } as Row['lead'] })
  const rows = [r('b', 10), r('a10', 30), r('shell'), r('a2', 20)]
  const keys = (l: Row[]) => l.map(x => x.key)

  it('keeps Herdr\'s order by default', () => {
    expect(keys(sortReady(rows, 'herdr', x => x.key))).toEqual(['b', 'a10', 'shell', 'a2'])
  })
  it('recent activity first; without a number (terminal) at the end', () => {
    expect(keys(sortReady(rows, 'recent', x => x.key))).toEqual(['a10', 'a2', 'b', 'shell'])
  })
  it('a space takes the most recent change of its panes', () => {
    const space = { kind: 'space', key: 'sp', lead: r('x', 1).lead, panes: [r('x', 1).lead, r('y', 99).lead] } as Row
    expect(keys(sortReady([...rows, space], 'recent', x => x.key))[0]).toBe('sp')
  })
  it('name: case-insensitive, digits in natural order', () => {
    expect(keys(sortReady(rows, 'name', x => x.key))).toEqual(['a2', 'a10', 'b', 'shell'])
  })
})
