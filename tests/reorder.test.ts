import { describe, expect, it } from 'vitest'
import { readyLists, sortReady } from '../shared/spaces'
import type { Row } from '../shared/spaces'

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
