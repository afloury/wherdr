// Layout of a Herdr tab (session.snapshot → `layouts[]`): pane rectangles
// in cells of the attached client (120×40 without a client), to reproduce as
// percentages whatever the screen size.

export interface CellRect { x: number, y: number, width: number, height: number }
// Split of Herdr's tree: `path` = path from the root ('' for the root,
// '0' first child, '1' second…), taken from its id (`split_2_11`); `right` =
// side by side (first on the left), `down` = stacked (first on top).
export interface LayoutSplit { path: string, direction: 'right' | 'down', ratio: number, rect: CellRect }
export interface TabLayout {
  tab: string
  workspace: string
  zoomed: boolean
  focused: string | null
  area: CellRect
  panes: { pane: string, rect: CellRect }[]
  // Missing: rebuilt layout or old state (no dragging or resizing).
  splits?: LayoutSplit[]
}
// Position of a pane as a percentage of the tab (0 to 100).
export interface PaneBox { pane: string, left: number, top: number, width: number, height: number }

const pct = (v: number, total: number) => (total > 0 ? Math.round((v / total) * 10000) / 100 : 0)

export function paneBoxes(layout: TabLayout): PaneBox[] {
  const { area } = layout
  return readingOrder(layout).map(({ pane, rect }) => ({
    pane,
    left: pct(rect.x - area.x, area.width),
    top: pct(rect.y - area.y, area.height),
    width: pct(rect.width, area.width),
    height: pct(rect.height, area.height),
  }))
}

// Reading order: Herdr's, which walks the split tree (left half
// before right, top before bottom): the left column first when
// it spans several rows, row by row for a grid split into
// rows. Used for swiping on the phone.
export function readingOrder(layout: TabLayout) {
  return layout.panes
}

// Neighbouring pane in reading order (swipe left / right), without wrapping.
export function neighborPane(layout: TabLayout, pane: string, step: 1 | -1): string | null {
  const order = readingOrder(layout).map(p => p.pane)
  const i = order.indexOf(pane)
  if (i < 0) return null
  return order[i + step] ?? null
}

// `layouts[]` brut de session.snapshot → TabLayout (identifiants tels quels).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reduceLayout(raw: any, id: (x: string) => string = x => x): TabLayout | null {
  if (!raw || !raw.tab_id || !raw.area || !Array.isArray(raw.panes)) return null
  const rect = (r: CellRect): CellRect => ({ x: r.x | 0, y: r.y | 0, width: r.width | 0, height: r.height | 0 })
  const splits: LayoutSplit[] = []
  for (const x of Array.isArray(raw.splits) ? raw.splits : []) {
    const path = splitPath(x?.id)
    if (path == null || !x.rect || (x.direction !== 'right' && x.direction !== 'down') || !(x.ratio > 0 && x.ratio < 1)) continue
    splits.push({ path, direction: x.direction, ratio: Number(x.ratio), rect: rect(x.rect) })
  }
  return {
    tab: id(String(raw.tab_id)),
    workspace: id(String(raw.workspace_id)),
    zoomed: Boolean(raw.zoomed),
    focused: raw.focused_pane_id ? id(String(raw.focused_pane_id)) : null,
    area: rect(raw.area),
    panes: raw.panes.filter((p: { pane_id?: string, rect?: CellRect }) => p && p.pane_id && p.rect)
      .map((p: { pane_id: string, rect: CellRect }) => ({ pane: id(p.pane_id), rect: rect(p.rect) })),
    ...(Array.isArray(raw.splits) ? { splits } : {}),
  }
}

// `split_0_root` -> '', `split_2_11` -> '11' (Herdr 0.9.1: rank of the split
// in the tree walk, then its path); null if unknown.
export function splitPath(id: unknown): string | null {
  if (id === 'split_0_root') return ''
  const m = /^split_\d+_([01]+)$/.exec(String(id ?? ''))
  return m ? m[1]! : null
}

// Layout to show for a tab: Herdr's, otherwise its panes
// stacked in equal parts (state without `layouts`, old state kept offline).
export function tabLayout(tab: { id: string, workspace: string, layout: TabLayout | null }, panes: string[]): TabLayout {
  if (tab.layout && tab.layout.panes.length) return tab.layout
  const n = Math.max(1, panes.length)
  const h = 40
  return {
    tab: tab.id,
    workspace: tab.workspace,
    zoomed: false,
    focused: panes[0] ?? null,
    area: { x: 0, y: 0, width: 120, height: h * n },
    panes: panes.map((pane, i) => ({ pane, rect: { x: 0, y: i * h, width: 120, height: h } })),
  }
}

// Preview of a split not made yet ("New pane" sheet): the pane
// cut in two, in equal parts as Herdr does by default, the new one
// (`newId`) on the right or at the bottom. Layout unchanged if the pane is not in it.
export function splitPreview(layout: TabLayout, pane: string, direction: 'right' | 'down', newId: string): TabLayout {
  const i = layout.panes.findIndex(p => p.pane === pane)
  if (i < 0) return layout
  const r = layout.panes[i]!.rect
  const [kept, added]: CellRect[] = direction === 'right'
    ? [{ ...r, width: Math.ceil(r.width / 2) }, { ...r, x: r.x + Math.ceil(r.width / 2), width: Math.floor(r.width / 2) }]
    : [{ ...r, height: Math.ceil(r.height / 2) }, { ...r, y: r.y + Math.ceil(r.height / 2), height: Math.floor(r.height / 2) }]
  const panes = [...layout.panes]
  panes.splice(i, 1, { pane, rect: kept! }, { pane: newId, rect: added! })
  return { ...layout, zoomed: false, panes }
}

// Geometric neighbour of a pane in a direction (swap with it, like
// Ctrl+B then Shift+H/J/K/L in Herdr): a pane touching that edge, the one that
// runs along it the most (on a tie, the topmost / leftmost). Herdr's rectangles
// touch without a gap. Null at the tab edge.
export type PaneDirection = 'left' | 'right' | 'up' | 'down'
export const PANE_DIRECTIONS: PaneDirection[] = ['left', 'right', 'up', 'down']

export function directionNeighbor(layout: TabLayout, pane: string, dir: PaneDirection): string | null {
  const me = layout.panes.find(p => p.pane === pane)?.rect
  if (!me) return null
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0)
  let best: { pane: string, len: number, at: number } | null = null
  for (const { pane: id, rect: r } of layout.panes) {
    if (id === pane) continue
    const horizontal = dir === 'left' || dir === 'right'
    const touches = dir === 'left' ? r.x + r.width === me.x
      : dir === 'right' ? me.x + me.width === r.x
        : dir === 'up' ? r.y + r.height === me.y
          : me.y + me.height === r.y
    const len = horizontal ? overlap(me.y, me.y + me.height, r.y, r.y + r.height) : overlap(me.x, me.x + me.width, r.x, r.x + r.width)
    if (!touches || len <= 0) continue
    const at = horizontal ? r.y : r.x
    if (!best || len > best.len || (len === best.len && at < best.at)) best = { pane: id, len, at }
  }
  return best?.pane ?? null
}

// Directions where a swap is possible: none in a zoomed tab (Herdr
// then shows only one pane).
export function swapDirections(layout: TabLayout, pane: string): PaneDirection[] {
  if (layout.zoomed) return []
  return PANE_DIRECTIONS.filter(d => directionNeighbor(layout, pane, d))
}

// Layout after swapping two panes (shown before Herdr confirms).
export function swapInLayout(layout: TabLayout, a: string, b: string): TabLayout {
  const ra = layout.panes.find(p => p.pane === a)?.rect
  const rb = layout.panes.find(p => p.pane === b)?.rect
  if (!ra || !rb || a === b) return layout
  // Herdr's active pane stays the same (wherdr restores it after the swap).
  return { ...layout, panes: layout.panes.map(p => (p.pane === a ? { pane: b, rect: ra } : p.pane === b ? { pane: a, rect: rb } : p)) }
}

// ---------- Split tree: drag and drop and resizing ----------
// The tree is rebuilt from `splits` (paths) and the pane rectangles;
// we recompute the rectangles like Herdr does (first child =
// rounded size × ratio) to show the result before it is confirmed.
export type LayoutNode = { pane: string } | { direction: 'right' | 'down', ratio: number, first: LayoutNode, second: LayoutNode }

export function layoutTree(layout: TabLayout): LayoutNode | null {
  if (!layout.splits) return null
  const byPath = new Map(layout.splits.map(s => [s.path, s]))
  const build = (path: string, panes: TabLayout['panes']): LayoutNode | null => {
    const s = byPath.get(path)
    if (!s) return panes.length === 1 ? { pane: panes[0]!.pane } : null
    const h = s.direction === 'right'
    const cut = h ? s.rect.x + s.rect.width * s.ratio : s.rect.y + s.rect.height * s.ratio
    const mid = (r: CellRect) => (h ? r.x + r.width / 2 : r.y + r.height / 2)
    const first = build(`${path}0`, panes.filter(p => mid(p.rect) < cut))
    const second = build(`${path}1`, panes.filter(p => mid(p.rect) >= cut))
    return first && second ? { direction: s.direction, ratio: s.ratio, first, second } : null
  }
  return build('', layout.panes)
}

// Rectangles of the panes and splits of a tree laid out in `area`.
export function treeLayout(base: TabLayout, tree: LayoutNode): TabLayout {
  const panes: TabLayout['panes'] = []
  const splits: LayoutSplit[] = []
  const walk = (n: LayoutNode, r: CellRect, path: string) => {
    if ('pane' in n) {
      panes.push({ pane: n.pane, rect: r })
      return
    }
    splits.push({ path, direction: n.direction, ratio: n.ratio, rect: r })
    const h = n.direction === 'right'
    const a = Math.round((h ? r.width : r.height) * n.ratio)
    walk(n.first, h ? { ...r, width: a } : { ...r, height: a }, `${path}0`)
    walk(n.second, h ? { ...r, x: r.x + a, width: r.width - a } : { ...r, y: r.y + a, height: r.height - a }, `${path}1`)
  }
  walk(tree, base.area, '')
  return { ...base, panes, splits }
}

// Shape of the tree (without ratios): to know whether a drop changes anything.
const shape = (n: LayoutNode): string => ('pane' in n ? n.pane : `${n.direction}(${shape(n.first)},${shape(n.second)})`)

// Drop zone under the pointer, on another pane's cell: center =
// swap, nearest edge = place beside. `edge`: width of the
// edge band, as a fraction of the cell.
export type DropSide = 'center' | PaneDirection
export function dropZone(box: { left: number, top: number, width: number, height: number }, x: number, y: number, edge = 0.28): DropSide | null {
  if (box.width <= 0 || box.height <= 0) return null
  const u = (x - box.left) / box.width
  const v = (y - box.top) / box.height
  if (u < 0 || u > 1 || v < 0 || v > 1) return null
  const d: [PaneDirection, number][] = [['left', u], ['right', 1 - u], ['up', v], ['down', 1 - v]]
  const [side, dist] = d.reduce((a, b) => (b[1] < a[1] ? b : a))
  return dist < edge ? side : 'center'
}

// Layout after dropping `pane` on `target`: swap (center) or
// pane removed from its place then put beside the target, half and half like
// Herdr. Null if nothing changes, in a zoomed tab or without a reliable tree.
export function dropPreview(layout: TabLayout, pane: string, target: string, side: DropSide): TabLayout | null {
  if (layout.zoomed || pane === target) return null
  const ids = layout.panes.map(p => p.pane)
  if (!ids.includes(pane) || !ids.includes(target)) return null
  if (side === 'center') return swapInLayout(layout, pane, target)
  const tree = layoutTree(layout)
  if (!tree) return null
  const without = (n: LayoutNode): LayoutNode | null => {
    if ('pane' in n) return n.pane === pane ? null : n
    const a = without(n.first)
    const b = without(n.second)
    return a && b ? { ...n, first: a, second: b } : a || b
  }
  const put = (n: LayoutNode): LayoutNode => {
    if ('pane' in n) {
      if (n.pane !== target) return n
      const me = { pane }
      const before = side === 'left' || side === 'up'
      return { direction: side === 'left' || side === 'right' ? 'right' : 'down', ratio: 0.5, first: before ? me : n, second: before ? n : me }
    }
    return { ...n, first: put(n.first), second: put(n.second) }
  }
  const rest = without(tree)
  if (!rest) return null
  const next = put(rest)
  if (shape(next) === shape(tree)) return null
  return treeLayout(layout, next)
}

// Movable dividers, as percentages of the tab: `at` =
// position of the divider (x for `right`, y for `down`), `from`/`span` = its
// extent on the other axis; `start`/`size` = the split on the divider's axis.
export interface Divider { path: string, direction: 'right' | 'down', ratio: number, at: number, from: number, span: number, start: number, size: number }
export function dividers(layout: TabLayout): Divider[] {
  if (layout.zoomed || !layout.splits || !layoutTree(layout)) return []
  const { area } = layout
  return layout.splits.map((s) => {
    const h = s.direction === 'right'
    const [start, size, total] = h ? [s.rect.x - area.x, s.rect.width, area.width] : [s.rect.y - area.y, s.rect.height, area.height]
    const [from, span, other] = h ? [s.rect.y - area.y, s.rect.height, area.height] : [s.rect.x - area.x, s.rect.width, area.width]
    return {
      path: s.path, direction: s.direction, ratio: s.ratio,
      at: pct(start + Math.round(size * s.ratio), total),
      from: pct(from, other), span: pct(span, other), start: pct(start, total), size: pct(size, total),
    }
  })
}

// Ratio of a split for a divider moved to `at` (same frame as Divider),
// clamped to leave at least `minCells` cells (and 5 %) on each side.
export function ratioAt(layout: TabLayout, d: Divider, at: number, minCells = 8): number {
  const cells = d.size / 100 * (d.direction === 'right' ? layout.area.width : layout.area.height)
  const min = Math.min(0.45, Math.max(0.05, cells > 0 ? minCells / cells : 0.5))
  const r = d.size > 0 ? (at - d.start) / d.size : d.ratio
  return Math.round(Math.min(1 - min, Math.max(min, r)) * 1000) / 1000
}

// Layout with a resized split (preview while dragging).
export function resizePreview(layout: TabLayout, path: string, ratio: number): TabLayout {
  const tree = layoutTree(layout)
  if (!tree) return layout
  const set = (n: LayoutNode, p: string): LayoutNode => {
    if ('pane' in n) return n
    if (p === path) return { ...n, ratio }
    return { ...n, first: set(n.first, `${p}0`), second: set(n.second, `${p}1`) }
  }
  return treeLayout(layout, set(tree, ''))
}
