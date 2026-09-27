import { describe, expect, it } from 'vitest'
import { afterClose, neighborTab } from '../shared/spaces'
import type { Pane, Workspace } from '../shared/types'

// w1 : onglets t1 (p1, p2, p3), t2 (p4), t3 (p5, p6) ; w2 : un seul onglet d'un pane.
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
  it('le précédent, le suivant pour le premier, aucun pour un onglet seul', () => {
    expect(neighborTab(s, 'w1:t1')).toBe('w1:t2')
    expect(neighborTab(s, 'w1:t2')).toBe('w1:t1')
    expect(neighborTab(s, 'w1:t3')).toBe('w1:t2')
    expect(neighborTab(s, 'w2:t1')).toBeNull()
    expect(neighborTab(s, 'w9:t1')).toBeNull()
  })
})

describe('après la fermeture d’un onglet', () => {
  it('premier / milieu / dernier : l’onglet voisin (le pane s’il est seul)', () => {
    expect(afterClose(s, { tab: 'w1:t1' }, { tab: 'w1:t1' })).toEqual({ pane: 'w1:p4' })
    expect(afterClose(s, { tab: 'w1:t2' }, { pane: 'w1:p4' })).toEqual({ tab: 'w1:t1' })
    expect(afterClose(s, { tab: 'w1:t3' }, { pane: 'w1:p6' })).toEqual({ pane: 'w1:p4' })
  })
  it('dernier onglet du space : la liste', () => {
    expect(afterClose(s, { tab: 'w2:t1' }, { pane: 'w2:p1' })).toBe('home')
  })
  it('un autre onglet ouvert, ou rien : on reste', () => {
    expect(afterClose(s, { tab: 'w1:t3' }, { tab: 'w1:t1' })).toBeNull()
    expect(afterClose(s, { tab: 'w1:t3' }, null)).toBeNull()
  })
})

describe('après la fermeture d’un pane', () => {
  it('il en reste plusieurs : le plan ou le côte à côte de l’onglet', () => {
    expect(afterClose(s, { pane: 'w1:p1' }, { pane: 'w1:p1' })).toEqual({ tab: 'w1:t1' })
    expect(afterClose(s, { pane: 'w1:p1' }, { tab: 'w1:t1' })).toBeNull()
  })
  it('il en reste un : ce pane', () => {
    expect(afterClose(s, { pane: 'w1:p5' }, { pane: 'w1:p5' })).toEqual({ pane: 'w1:p6' })
    expect(afterClose(s, { pane: 'w1:p5' }, { tab: 'w1:t3' })).toEqual({ pane: 'w1:p6' })
  })
  it('un autre pane de l’onglet est ouvert : il reste', () => {
    expect(afterClose(s, { pane: 'w1:p5' }, { pane: 'w1:p6' })).toBeNull()
  })
  it('dernier pane de l’onglet : l’onglet voisin, sinon la liste', () => {
    expect(afterClose(s, { pane: 'w1:p4' }, { pane: 'w1:p4' })).toEqual({ tab: 'w1:t1' })
    expect(afterClose(s, { pane: 'w2:p1' }, { pane: 'w2:p1' })).toBe('home')
  })
})

describe('après la fermeture d’un espace', () => {
  it('la liste si on y était, sinon on reste', () => {
    expect(afterClose(s, { workspace: 'w1' }, { pane: 'w1:p5' })).toBe('home')
    expect(afterClose(s, { workspace: 'w1' }, { tab: 'w1:t1' })).toBe('home')
    expect(afterClose(s, { workspace: 'w1' }, { pane: 'w2:p1' })).toBeNull()
  })
})
