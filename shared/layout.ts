// Disposition d'un onglet Herdr (session.snapshot → `layouts[]`) : rectangles des
// panes en cellules du client attaché (120×40 sans client), à reproduire en
// pourcentages quelle que soit la taille de l'écran.

export interface CellRect { x: number, y: number, width: number, height: number }
// Split de l'arbre de Herdr : `path` = chemin depuis la racine ('' pour elle,
// '0' premier enfant, '1' second…), tiré de son id (`split_2_11`) ; `right` =
// côte à côte (premier à gauche), `down` = empilés (premier en haut).
export interface LayoutSplit { path: string, direction: 'right' | 'down', ratio: number, rect: CellRect }
export interface TabLayout {
  tab: string
  workspace: string
  zoomed: boolean
  focused: string | null
  area: CellRect
  panes: { pane: string, rect: CellRect }[]
  // Absent : disposition reconstituée ou ancien état (ni glisser ni redimensionner).
  splits?: LayoutSplit[]
}
// Position d'un pane en pourcentage de l'onglet (0 à 100).
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

// Ordre de lecture : celui de Herdr, qui parcourt l'arbre des splits (moitié
// gauche avant la droite, haut avant bas) : la colonne de gauche d'abord quand
// elle couvre plusieurs rangées, rangée par rangée pour une grille coupée en
// rangées. Sert au balayage sur téléphone.
export function readingOrder(layout: TabLayout) {
  return layout.panes
}

// Pane voisin dans l'ordre de lecture (balayage gauche / droite), sans boucler.
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

// `split_0_root` -> '', `split_2_11` -> '11' (Herdr 0.9.1 : rang du split
// dans le parcours de l'arbre, puis son chemin) ; null si inconnu.
export function splitPath(id: unknown): string | null {
  if (id === 'split_0_root') return ''
  const m = /^split_\d+_([01]+)$/.exec(String(id ?? ''))
  return m ? m[1]! : null
}

// Disposition à afficher pour un onglet : celle de Herdr, sinon ses panes
// empilés à parts égales (état sans `layouts`, ancien état gardé hors ligne).
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

// Aperçu d'une division pas encore faite (feuille « Nouveau pane ») : le pane
// coupé en deux, à parts égales comme le fait Herdr par défaut, le nouveau
// (`newId`) à droite ou en bas. Disposition inchangée si le pane n'y est pas.
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

// Voisin géométrique d'un pane dans une direction (échanger avec lui, comme
// Ctrl+B puis Shift+H/J/K/L dans Herdr) : un pane collé à ce bord, celui qui le
// longe le plus (à égalité, le plus haut / le plus à gauche). Les rectangles
// de Herdr se touchent sans espace. Null au bord de l'onglet.
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

// Directions où un échange est possible : pas dans un onglet agrandi (Herdr
// ne montre alors qu'un pane).
export function swapDirections(layout: TabLayout, pane: string): PaneDirection[] {
  if (layout.zoomed) return []
  return PANE_DIRECTIONS.filter(d => directionNeighbor(layout, pane, d))
}

// Disposition après l'échange de deux panes (affichée avant la confirmation de Herdr).
export function swapInLayout(layout: TabLayout, a: string, b: string): TabLayout {
  const ra = layout.panes.find(p => p.pane === a)?.rect
  const rb = layout.panes.find(p => p.pane === b)?.rect
  if (!ra || !rb || a === b) return layout
  // Le pane actif de Herdr reste le même (wherdr le rétablit après l'échange).
  return { ...layout, panes: layout.panes.map(p => (p.pane === a ? { pane: b, rect: ra } : p.pane === b ? { pane: a, rect: rb } : p)) }
}

// ---------- Arbre des splits : glisser-déposer et redimensionnement ----------
// L'arbre est reconstitué depuis `splits` (chemins) et les rectangles des
// panes ; on en recalcule les rectangles comme Herdr (premier enfant =
// arrondi de taille × ratio) pour montrer le résultat avant sa confirmation.
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

// Rectangles des panes et des splits d'un arbre posé dans `area`.
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

// Forme de l'arbre (sans les ratios) : pour savoir si un dépôt change quelque chose.
const shape = (n: LayoutNode): string => ('pane' in n ? n.pane : `${n.direction}(${shape(n.first)},${shape(n.second)})`)

// Zone de dépôt sous le pointeur, sur la case d'un autre pane : centre =
// échanger, bord le plus proche = placer à côté. `edge` : largeur de la
// bande des bords, en fraction de la case.
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

// Disposition après avoir déposé `pane` sur `target` : échange (centre) ou
// pane retiré de sa place puis posé à côté de la cible, moitié-moitié comme
// Herdr. Null si rien ne change, dans un onglet agrandi ou sans arbre fiable.
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

// Traits de séparation déplaçables, en pourcentages de l'onglet : `at` =
// position du trait (x pour `right`, y pour `down`), `from`/`span` = son
// étendue sur l'autre axe ; `start`/`size` = le split sur l'axe du trait.
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

// Ratio d'un split pour un trait amené à `at` (même repère que Divider),
// borné pour laisser au moins `minCells` cellules (et 5 %) de chaque côté.
export function ratioAt(layout: TabLayout, d: Divider, at: number, minCells = 8): number {
  const cells = d.size / 100 * (d.direction === 'right' ? layout.area.width : layout.area.height)
  const min = Math.min(0.45, Math.max(0.05, cells > 0 ? minCells / cells : 0.5))
  const r = d.size > 0 ? (at - d.start) / d.size : d.ratio
  return Math.round(Math.min(1 - min, Math.max(min, r)) * 1000) / 1000
}

// Disposition avec un split redimensionné (aperçu pendant le glissé).
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
