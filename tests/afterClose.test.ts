import { describe, expect, it } from 'vitest'
import { afterClose, neighborTab } from '../shared/spaces'
import type { Pane, Workspace } from '../shared/types'

// w1: tabs t1 (p1, p2, p3), t2 (p4), t3 (p5, p6); w2: a single tab with one pane.
const pane = (id: string) => {
  const [w, p] = id.split(':')
  const tab = { p1: 't1', p2: 't1', p3: 't1', p4: 't2', p5: 't3', p6: 't3' }[p!] || 't1'
  return { id, workspace: w, tab: `${w}:${tab}`, tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: null, agentSession: null } as Pane
}
const ws = (id: string, number: number) => ({ id, label: id, number, status: null, worktree: false }) as Workspace
const s = {
  workspaces: [ws('w1', 1), ws('w2', 2)],
  panes: ['w1:p1', 'w1:p2', 'w1:p3', 'w1:p4', 'w1:p5', 'w1:p6', 'w2:p1'].map(pane),
}

describe('onglet voisin', () => {
  it('the previous one, the next one for the first, none for a lone tab', () => {
    expect(neighborTab(s, 'w1:t1')).toBe('w1:t2')
    expect(neighborTab(s, 'w1:t2')).toBe('w1:t1')
    expect(neighborTab(s, 'w1:t3')).toBe('w1:t2')
    expect(neighborTab(s, 'w2:t1')).toBeNull()
    expect(neighborTab(s, 'w9:t1')).toBeNull()
  })
})

describe('after closing a tab', () => {
  it('first / middle / last: the neighbouring tab (the pane if it is alone)', () => {
    expect(afterClose(s, { tab: 'w1:t1' }, { tab: 'w1:t1' })).toEqual({ pane: 'w1:p4' })
    expect(afterClose(s, { tab: 'w1:t2' }, { pane: 'w1:p4' })).toEqual({ tab: 'w1:t1' })
    expect(afterClose(s, { tab: 'w1:t3' }, { pane: 'w1:p6' })).toEqual({ pane: 'w1:p4' })
  })
  it('dernier onglet du space : la liste', () => {
    expect(afterClose(s, { tab: 'w2:t1' }, { pane: 'w2:p1' })).toBe('home')
  })
  it('another tab open, or nothing: we stay', () => {
    expect(afterClose(s, { tab: 'w1:t3' }, { tab: 'w1:t1' })).toBeNull()
    expect(afterClose(s, { tab: 'w1:t3' }, null)).toBeNull()
  })
})

describe('after closing a pane', () => {
  it('several remain: the tab plan or side by side', () => {
    expect(afterClose(s, { pane: 'w1:p1' }, { pane: 'w1:p1' })).toEqual({ tab: 'w1:t1' })
    expect(afterClose(s, { pane: 'w1:p1' }, { tab: 'w1:t1' })).toBeNull()
  })
  it('one remains: that pane', () => {
    expect(afterClose(s, { pane: 'w1:p5' }, { pane: 'w1:p5' })).toEqual({ pane: 'w1:p6' })
    expect(afterClose(s, { pane: 'w1:p5' }, { tab: 'w1:t3' })).toEqual({ pane: 'w1:p6' })
  })
  it('another pane of the tab is open: it stays', () => {
    expect(afterClose(s, { pane: 'w1:p5' }, { pane: 'w1:p6' })).toBeNull()
  })
  it('last pane of the tab: the neighbouring tab, otherwise the list', () => {
    expect(afterClose(s, { pane: 'w1:p4' }, { pane: 'w1:p4' })).toEqual({ tab: 'w1:t1' })
    expect(afterClose(s, { pane: 'w2:p1' }, { pane: 'w2:p1' })).toBe('home')
  })
})

describe('after closing a space', () => {
  it('the list if we were there, otherwise we stay', () => {
    expect(afterClose(s, { workspace: 'w1' }, { pane: 'w1:p5' })).toBe('home')
    expect(afterClose(s, { workspace: 'w1' }, { tab: 'w1:t1' })).toBe('home')
    expect(afterClose(s, { workspace: 'w1' }, { pane: 'w2:p1' })).toBeNull()
  })
})
