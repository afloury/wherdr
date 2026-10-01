import { describe, expect, it } from 'vitest'
import { neighborPane, paneBoxes, readingOrder, reduceLayout, splitPreview } from '../shared/layout'
import snap from './fixtures/snapshot-layouts.json'

// Real layout (hwtest session, Herdr 0.9.1): w1:t1 = p1 on the left (55 %),
// p2 above p3 on the right.
const dev = reduceLayout(snap.layouts[0])!

describe('layout', () => {
  it('lit la disposition du snapshot', () => {
    expect(dev.tab).toBe('w1:t1')
    expect(dev.area).toEqual({ x: 0, y: 0, width: 120, height: 40 })
    expect(dev.panes.map(p => p.pane)).toEqual(['w1:p1', 'w1:p2', 'w1:p3'])
    expect(reduceLayout(null)).toBeNull()
  })

  it('prefixes the identifiers of a remote machine', () => {
    const l = reduceLayout(snap.layouts[0], x => `abcd1234~${x}`)!
    expect(l.focused).toBe('abcd1234~w1:p1')
    expect(l.panes[2]!.pane).toBe('abcd1234~w1:p3')
  })

  it('converts cells to percentages', () => {
    expect(paneBoxes(dev)).toEqual([
      { pane: 'w1:p1', left: 0, top: 0, width: 55, height: 100 },
      { pane: 'w1:p2', left: 55, top: 0, width: 45, height: 50 },
      { pane: 'w1:p3', left: 55, top: 50, width: 45, height: 50 },
    ])
  })

  it('reading order and neighbours for swiping', () => {
    expect(readingOrder(dev).map(p => p.pane)).toEqual(['w1:p1', 'w1:p2', 'w1:p3'])
    expect(neighborPane(dev, 'w1:p1', 1)).toBe('w1:p2')
    expect(neighborPane(dev, 'w1:p3', 1)).toBeNull()
    expect(neighborPane(dev, 'w1:p1', -1)).toBeNull()
    expect(neighborPane(dev, 'w9:p9', 1)).toBeNull()
  })

  it('grid split into rows: row by row', () => {
    // Herdr 0.9.1: split downwards, then each row cut in two.
    const cell = (pane: string, x: number, y: number) => ({ pane_id: pane, rect: { x, y, width: 60, height: 20 } })
    const grid = reduceLayout({
      tab_id: 'w3:t1', workspace_id: 'w3', zoomed: true, focused_pane_id: 'w3:p4', area: { x: 0, y: 0, width: 120, height: 40 },
      panes: [cell('w3:p1', 0, 0), cell('w3:p3', 60, 0), cell('w3:p2', 0, 20), cell('w3:p4', 60, 20)],
    })!
    expect(grid.zoomed).toBe(true)
    expect(readingOrder(grid).map(p => p.pane)).toEqual(['w3:p1', 'w3:p3', 'w3:p2', 'w3:p4'])
    expect(neighborPane(grid, 'w3:p3', 1)).toBe('w3:p2')
    expect(neighborPane(grid, 'w3:p3', -1)).toBe('w3:p1')
    expect(paneBoxes(grid)[1]).toEqual({ pane: 'w3:p3', left: 50, top: 0, width: 50, height: 50 })
  })
})

describe('split preview', () => {
  const base = { tab: 't1', workspace: 'w1', zoomed: false, focused: 'p1', area: { x: 0, y: 0, width: 120, height: 40 }, panes: [{ pane: 'p1', rect: { x: 0, y: 0, width: 120, height: 40 } }] }
  it('right: left half kept, new pane on the right', () => {
    expect(paneBoxes(splitPreview(base, 'p1', 'right', 'new'))).toEqual([
      { pane: 'p1', left: 0, top: 0, width: 50, height: 100 },
      { pane: 'new', left: 50, top: 0, width: 50, height: 100 },
    ])
  })
  it('down: new pane below; unknown pane: unchanged', () => {
    expect(splitPreview(base, 'p1', 'down', 'new').panes[1]).toEqual({ pane: 'new', rect: { x: 0, y: 20, width: 120, height: 20 } })
    expect(splitPreview(base, 'p9', 'down', 'new')).toBe(base)
  })
})
