import { describe, expect, it } from 'vitest'
import { type TabLayout, directionNeighbor, swapDirections, swapInLayout } from '../shared/layout'
import { spaceCall, swapSteps } from '../shared/spaceActions'

const R = 'abcd1234'
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
const layout = (panes: [string, ReturnType<typeof rect>][], zoomed = false): TabLayout => ({
  tab: 'w1:t1', workspace: 'w1', zoomed, focused: panes[0]![0], area: rect(0, 0, 120, 40),
  panes: panes.map(([pane, r]) => ({ pane, rect: r })),
})
// 2×2 grid as Herdr describes it (left column first).
const grid = layout([['p1', rect(0, 0, 60, 20)], ['p3', rect(0, 20, 60, 20)], ['p2', rect(60, 0, 60, 20)], ['p4', rect(60, 20, 60, 20)]])
// Tall column on the left, two panes stacked on the right.
const tall = layout([['a', rect(0, 0, 60, 40)], ['b', rect(60, 0, 60, 30)], ['c', rect(60, 30, 60, 10)]])

describe('voisins par direction', () => {
  it('grille 2×2 : deux voisins par pane', () => {
    expect(swapDirections(grid, 'p1')).toEqual(['right', 'down'])
    expect(swapDirections(grid, 'p4')).toEqual(['left', 'up'])
    expect(directionNeighbor(grid, 'p4', 'left')).toBe('p3')
    expect(directionNeighbor(grid, 'p4', 'up')).toBe('p2')
    expect(directionNeighbor(grid, 'p1', 'left')).toBeNull()
  })

  it('tall column: the neighbour running along it the most', () => {
    expect(directionNeighbor(tall, 'a', 'right')).toBe('b')
    expect(directionNeighbor(tall, 'c', 'left')).toBe('a')
    expect(swapDirections(tall, 'a')).toEqual(['right'])
    expect(swapDirections(tall, 'c')).toEqual(['left', 'up'])
  })

  it('nothing in a zoomed tab, a lone pane or an unknown one', () => {
    expect(swapDirections({ ...grid, zoomed: true }, 'p1')).toEqual([])
    expect(swapDirections(layout([['x', rect(0, 0, 120, 40)]]), 'x')).toEqual([])
    expect(swapDirections(grid, 'zz')).toEqual([])
  })

  it('swaps rectangles, order and active pane unchanged', () => {
    const s = swapInLayout(grid, 'p4', 'p3')
    expect(s.panes.map(p => p.pane)).toEqual(['p1', 'p4', 'p2', 'p3'])
    expect(s.panes.find(p => p.pane === 'p4')!.rect).toEqual(rect(0, 20, 60, 20))
    expect(s.focused).toBe('p1')
    expect(swapInLayout(grid, 'p4', 'nope')).toBe(grid)
  })
})

describe('appel pane.swap', () => {
  it('goes to the pane\'s machine, direction checked', () => {
    expect(spaceCall({ op: 'pane.swap', pane_id: `${R}~w1:p4`, direction: 'left' })).toEqual({
      machine: R, method: 'pane.swap', params: { pane_id: 'w1:p4', direction: 'left' },
    })
    expect(spaceCall({ op: 'pane.swap', pane_id: 'w1:p1', direction: 'down' }).machine).toBe('')
    expect(() => spaceCall({ op: 'pane.swap', pane_id: 'w1:p1', direction: 'north' })).toThrow(/direction/)
    expect(() => spaceCall({ op: 'pane.swap', pane_id: 'w1', direction: 'up' })).toThrow(/invalid pane/)
  })

  // Minimal session.snapshot: two spaces, the attached client on w2.
  const snap = (over: { tabFocus?: string, focus?: string, active?: string, zoomed?: boolean } = {}) => ({
    focused_pane_id: over.focus ?? 'w2:p1',
    workspaces: [{ workspace_id: 'w1', active_tab_id: over.active ?? 'w1:t1' }, { workspace_id: 'w2', active_tab_id: 'w2:t1' }],
    layouts: [
      { tab_id: 'w1:t1', workspace_id: 'w1', zoomed: Boolean(over.zoomed), focused_pane_id: over.tabFocus ?? 'w1:p1', panes: [{ pane_id: 'w1:p1' }, { pane_id: 'w1:p3' }, { pane_id: 'w1:p2' }, { pane_id: 'w1:p4' }] },
      { tab_id: 'w1:t2', workspace_id: 'w1', focused_pane_id: 'w1:p9', panes: [{ pane_id: 'w1:p9' }] },
      { tab_id: 'w2:t1', workspace_id: 'w2', focused_pane_id: 'w2:p1', panes: [{ pane_id: 'w2:p1' }] },
    ],
  })

  it('focus restored: active pane of the tab, then the session\'s', () => {
    expect(swapSteps(snap(), 'w1:p4', 'w1:p3')).toEqual([
      { method: 'pane.swap', params: { source_pane_id: 'w1:p4', target_pane_id: 'w1:p3' } },
      { method: 'pane.focus', params: { pane_id: 'w1:p1' } },
      { method: 'pane.focus', params: { pane_id: 'w2:p1' } },
    ])
  })

  it('the tab\'s active pane is the source: nothing to restore in the tab', () => {
    expect(swapSteps(snap({ tabFocus: 'w1:p3', focus: 'w1:p3' }), 'w1:p4', 'w1:p3')).toEqual([
      { method: 'pane.swap', params: { source_pane_id: 'w1:p3', target_pane_id: 'w1:p4' } },
    ])
    expect(swapSteps(snap({ tabFocus: 'w1:p4', focus: 'w1:p4' }), 'w1:p4', 'w1:p3')).toHaveLength(1)
  })

  it('another active tab in the space: it becomes active again', () => {
    expect(swapSteps(snap({ active: 'w1:t2', focus: 'w1:p9' }), 'w1:p4', 'w1:p3').slice(1)).toEqual([
      { method: 'pane.focus', params: { pane_id: 'w1:p1' } },
      { method: 'pane.focus', params: { pane_id: 'w1:p9' } },
    ])
  })

  it('refused without a neighbour, outside the tab or in a zoomed tab', () => {
    expect(() => swapSteps(snap(), 'w1:p4', null)).toThrow(/no pane/)
    expect(() => swapSteps(snap(), 'w1:p4', 'w1:p9')).toThrow(/no pane/)
    expect(() => swapSteps(snap({ zoomed: true }), 'w1:p4', 'w1:p3')).toThrow(/zoomed/)
  })
})
