import { describe, expect, it } from 'vitest'
import {
  type TabLayout, dividers, layoutTree, reduceLayout, resizePreview, splitPath, treeLayout,
} from '../shared/layout'
import snap from './fixtures/snapshot-layouts.json'

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
// Layout captured in a test session (Herdr 0.9.1): p1 on the left
// (65 %), p2 top right, p3 | p4 bottom right (30 %).
const raw = {
  tab_id: 'w1:t1', workspace_id: 'w1', zoomed: false, focused_pane_id: 'w1:p1', area: rect(0, 0, 120, 40),
  panes: [
    { pane_id: 'w1:p1', rect: rect(0, 0, 78, 40) }, { pane_id: 'w1:p2', rect: rect(78, 0, 42, 20) },
    { pane_id: 'w1:p3', rect: rect(78, 20, 13, 20) }, { pane_id: 'w1:p4', rect: rect(91, 20, 29, 20) },
  ],
  splits: [
    { id: 'split_0_root', direction: 'right', ratio: 0.65, rect: rect(0, 0, 120, 40) },
    { id: 'split_1_1', direction: 'down', ratio: 0.5, rect: rect(78, 0, 42, 40) },
    { id: 'split_2_11', direction: 'right', ratio: 0.3, rect: rect(78, 20, 42, 20) },
  ],
}
const L = reduceLayout(raw)!
const order = (l: TabLayout | null) => l?.panes.map(p => `${p.pane} ${p.rect.x},${p.rect.y} ${p.rect.width}x${p.rect.height}`)

describe('arbre des splits', () => {
  it('path taken from the Herdr id', () => {
    expect(splitPath('split_0_root')).toBe('')
    expect(splitPath('split_1_0')).toBe('0')
    expect(splitPath('split_2_11')).toBe('11')
    // The number is the split's rank (tree walk), not its depth.
    expect(splitPath('split_2_1')).toBe('1')
    expect(splitPath('split_2_')).toBeNull()
    expect(splitPath('nope')).toBeNull()
  })

  it('reads the splits of the snapshot (and of the fixture)', () => {
    expect(L.splits!.map(s => [s.path, s.direction, s.ratio])).toEqual([['', 'right', 0.65], ['1', 'down', 0.5], ['11', 'right', 0.3]])
    expect(reduceLayout(snap.layouts[0])!.splits).toHaveLength(2)
    expect(reduceLayout({ ...raw, splits: undefined })!.splits).toBeUndefined()
  })

  it('recalcule exactement les rectangles de Herdr', () => {
    const tree = layoutTree(L)!
    expect(tree).toMatchObject({ direction: 'right', first: { pane: 'w1:p1' }, second: { direction: 'down', second: { direction: 'right' } } })
    expect(treeLayout(L, tree).panes).toEqual(L.panes)
    const fix = reduceLayout(snap.layouts[0])!
    expect(treeLayout(fix, layoutTree(fix)!).panes).toEqual(fix.panes)
  })

  it('2×2 grid captured in Herdr (split_1_0, split_2_1)', () => {
    const g = reduceLayout({
      ...raw,
      panes: [
        { pane_id: 'a', rect: rect(0, 0, 60, 20) }, { pane_id: 'b', rect: rect(60, 0, 60, 20) },
        { pane_id: 'c', rect: rect(0, 20, 60, 20) }, { pane_id: 'd', rect: rect(60, 20, 60, 20) },
      ],
      splits: [
        { id: 'split_0_root', direction: 'down', ratio: 0.5, rect: rect(0, 0, 120, 40) },
        { id: 'split_1_0', direction: 'right', ratio: 0.5, rect: rect(0, 0, 120, 20) },
        { id: 'split_2_1', direction: 'right', ratio: 0.5, rect: rect(0, 20, 120, 20) },
      ],
    })!
    expect(dividers(g).map(d => d.path)).toEqual(['', '0', '1'])
    expect(treeLayout(g, layoutTree(g)!).panes).toEqual(g.panes)
  })

  it('no tree without splits or if they do not match the panes', () => {
    expect(layoutTree({ ...L, splits: undefined })).toBeNull()
    expect(layoutTree({ ...L, splits: L.splits!.slice(0, 1) })).toBeNull()
  })
})

describe('dividers', () => {
  it('position and extent as percentages', () => {
    const [root, right, bottom] = dividers(L)
    expect(root).toMatchObject({ path: '', direction: 'right', at: 65, from: 0, span: 100, start: 0, size: 100 })
    expect(right).toMatchObject({ path: '1', direction: 'down', at: 50, from: 65, span: 35 })
    expect(bottom).toMatchObject({ path: '11', at: 75.83, from: 50, span: 50, start: 65, size: 35 })
    expect(dividers({ ...L, zoomed: true })).toEqual([])
    expect(dividers({ ...L, splits: undefined })).toEqual([])
  })

  it('resized preview, rounded as Herdr does', () => {
    expect(order(resizePreview(L, '', 0.5))).toEqual([
      'w1:p1 0,0 60x40', 'w1:p2 60,0 60x20', 'w1:p3 60,20 18x20', 'w1:p4 78,20 42x20',
    ])
    expect(resizePreview(L, '', 0.5).splits![0]!.ratio).toBe(0.5)
  })
})
