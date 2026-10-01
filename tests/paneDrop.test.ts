import { describe, expect, it } from 'vitest'
import {
  type TabLayout, dividers, dropPreview, dropZone, layoutTree, ratioAt, reduceLayout, resizePreview, splitPath, treeLayout,
} from '../shared/layout'
import { dropSteps, spaceCall } from '../shared/spaceActions'
import snap from './fixtures/snapshot-layouts.json'

const R = 'abcd1234'
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
// Disposition relevée dans une session de test (Herdr 0.9.1) : p1 à gauche
// (65 %), p2 en haut à droite, p3 | p4 en bas à droite (30 %).
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
  it('chemin tiré de l’id de Herdr', () => {
    expect(splitPath('split_0_root')).toBe('')
    expect(splitPath('split_1_0')).toBe('0')
    expect(splitPath('split_2_11')).toBe('11')
    // Le nombre est le rang du split (parcours de l'arbre), pas sa profondeur.
    expect(splitPath('split_2_1')).toBe('1')
    expect(splitPath('split_2_')).toBeNull()
    expect(splitPath('nope')).toBeNull()
  })

  it('lit les splits du snapshot (et de la fixture)', () => {
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

  it('grille 2×2 relevée dans Herdr (split_1_0, split_2_1)', () => {
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

  it('pas d’arbre sans splits ou s’ils ne collent pas aux panes', () => {
    expect(layoutTree({ ...L, splits: undefined })).toBeNull()
    expect(layoutTree({ ...L, splits: L.splits!.slice(0, 1) })).toBeNull()
  })
})

describe('zone de dépôt', () => {
  const box = { left: 50, top: 0, width: 50, height: 100 }
  it('centre = échanger, bord le plus proche = placer à côté', () => {
    expect(dropZone(box, 75, 50)).toBe('center')
    expect(dropZone(box, 52, 50)).toBe('left')
    expect(dropZone(box, 98, 50)).toBe('right')
    expect(dropZone(box, 75, 5)).toBe('up')
    expect(dropZone(box, 75, 95)).toBe('down')
    // Coin : le bord le plus proche l'emporte.
    expect(dropZone(box, 51, 10)).toBe('left')
  })
  it('hors de la case : rien', () => {
    expect(dropZone(box, 40, 50)).toBeNull()
    expect(dropZone({ ...box, width: 0 }, 50, 50)).toBeNull()
  })
})

describe('aperçu d’un dépôt', () => {
  it('échange au centre', () => {
    expect(order(dropPreview(L, 'w1:p1', 'w1:p4', 'center'))![0]).toBe('w1:p4 0,0 78x40')
  })

  it('p4 posé à gauche de p1 : colonne coupée en deux, p3 prend toute la rangée', () => {
    expect(order(dropPreview(L, 'w1:p4', 'w1:p1', 'left'))).toEqual([
      'w1:p4 0,0 39x40', 'w1:p1 39,0 39x40', 'w1:p2 78,0 42x20', 'w1:p3 78,20 42x20',
    ])
  })

  it('p1 posé sous p2 : la colonne de droite prend tout l’onglet', () => {
    expect(order(dropPreview(L, 'w1:p1', 'w1:p2', 'down'))).toEqual([
      'w1:p2 0,0 120x10', 'w1:p1 0,10 120x10', 'w1:p3 0,20 36x20', 'w1:p4 36,20 84x20',
    ])
  })

  it('bord qui ne change rien : null (p4 est déjà à droite de p3)', () => {
    expect(dropPreview(L, 'w1:p4', 'w1:p3', 'right')).toBeNull()
    expect(dropPreview(L, 'w1:p3', 'w1:p4', 'left')).toBeNull()
    // Mais l'inverse les échange de place.
    expect(dropPreview(L, 'w1:p3', 'w1:p4', 'right')).not.toBeNull()
  })

  it('refusé : même pane, pane inconnu, onglet agrandi, sans arbre', () => {
    expect(dropPreview(L, 'w1:p1', 'w1:p1', 'left')).toBeNull()
    expect(dropPreview(L, 'w1:p9', 'w1:p1', 'left')).toBeNull()
    expect(dropPreview({ ...L, zoomed: true }, 'w1:p1', 'w1:p2', 'center')).toBeNull()
    expect(dropPreview({ ...L, splits: undefined }, 'w1:p1', 'w1:p2', 'left')).toBeNull()
  })
})

describe('traits de séparation', () => {
  it('position et étendue en pourcentages', () => {
    const [root, right, bottom] = dividers(L)
    expect(root).toMatchObject({ path: '', direction: 'right', at: 65, from: 0, span: 100, start: 0, size: 100 })
    expect(right).toMatchObject({ path: '1', direction: 'down', at: 50, from: 65, span: 35 })
    expect(bottom).toMatchObject({ path: '11', at: 75.83, from: 50, span: 50, start: 65, size: 35 })
    expect(dividers({ ...L, zoomed: true })).toEqual([])
    expect(dividers({ ...L, splits: undefined })).toEqual([])
  })

  it('déplacement du pointeur -> ratio, borné', () => {
    const [root, , bottom] = dividers(L)
    expect(ratioAt(L, root!, 40)).toBe(0.4)
    // 8 cellules au moins de chaque côté : 8 / 120.
    expect(ratioAt(L, root!, 1)).toBe(0.067)
    expect(ratioAt(L, root!, 99)).toBe(0.933)
    // Split de 42 cellules : pointeur à 70 % de l'onglet -> (70 - 65) / 35.
    expect(ratioAt(L, bottom!, 70)).toBe(0.19)
    expect(ratioAt(L, bottom!, 65)).toBe(0.19)
  })

  it('aperçu redimensionné, comme Herdr l’arrondit', () => {
    expect(order(resizePreview(L, '', 0.5))).toEqual([
      'w1:p1 0,0 60x40', 'w1:p2 60,0 60x20', 'w1:p3 60,20 18x20', 'w1:p4 78,20 42x20',
    ])
    expect(resizePreview(L, '', 0.5).splits![0]!.ratio).toBe(0.5)
  })
})

describe('appels', () => {
  it('pane.drop : même machine, côté contrôlé', () => {
    expect(spaceCall({ op: 'pane.drop', pane_id: `${R}~w1:p4`, target_pane_id: `${R}~w1:p1`, side: 'left' })).toEqual({
      machine: R, method: 'pane.drop', params: { pane_id: 'w1:p4', target_pane_id: 'w1:p1', side: 'left' },
    })
    expect(spaceCall({ op: 'pane.drop', pane_id: 'w1:p4', target_pane_id: 'w1:p1', side: 'center' }).params.side).toBe('center')
    expect(() => spaceCall({ op: 'pane.drop', pane_id: 'w1:p4', target_pane_id: `${R}~w1:p1`, side: 'left' })).toThrow(/another machine/)
    expect(() => spaceCall({ op: 'pane.drop', pane_id: 'w1:p4', target_pane_id: 'w1:p1', side: 'middle' })).toThrow(/direction/)
  })

  it('layout.ratio -> layout.set_split_ratio avec le chemin en booléens', () => {
    expect(spaceCall({ op: 'layout.ratio', tab_id: `${R}~w1:t1`, path: '11', ratio: 0.3 })).toEqual({
      machine: R, method: 'layout.set_split_ratio', params: { tab_id: 'w1:t1', path: [true, true], ratio: 0.3 },
    })
    expect(spaceCall({ op: 'layout.ratio', tab_id: 'w1:t1', path: '', ratio: 0.99 }).params).toEqual({ tab_id: 'w1:t1', path: [], ratio: 0.95 })
    expect(() => spaceCall({ op: 'layout.ratio', tab_id: 'w1:t1', path: '12', ratio: 0.5 })).toThrow(/split/)
    expect(() => spaceCall({ op: 'layout.ratio', tab_id: 'w1:t1', path: '', ratio: 1 })).toThrow(/ratio/)
    expect(() => spaceCall({ op: 'layout.ratio', tab_id: 'w1:t1', path: '', ratio: 'x' })).toThrow(/ratio/)
  })

  const s = (tabFocus = 'w1:p1') => ({
    focused_pane_id: 'w1:p1',
    workspaces: [{ workspace_id: 'w1', active_tab_id: 'w1:t1' }],
    layouts: [{ tab_id: 'w1:t1', workspace_id: 'w1', focused_pane_id: tabFocus, panes: [{ pane_id: 'w1:p1' }, { pane_id: 'w1:p2' }, { pane_id: 'w1:p3' }] }],
  })

  it('bord droit / bas : onglet temporaire puis retour à côté de la cible', () => {
    expect(dropSteps(s(), 'w1:p3', 'w1:p1', 'down')).toEqual([
      { method: 'pane.move', params: { pane_id: 'w1:p3', destination: { type: 'new_tab', workspace_id: 'w1' }, focus: false } },
      { method: 'pane.move', params: { pane_id: 'w1:p3', destination: { type: 'tab', tab_id: 'w1:t1', split: 'down', target_pane_id: 'w1:p1' }, focus: false } },
      { method: 'pane.focus', params: { pane_id: 'w1:p1' } },
    ])
  })

  it('bord gauche / haut : puis échange avec la cible, focus rendu', () => {
    const steps = dropSteps(s(), 'w1:p3', 'w1:p2', 'left')
    expect(steps[1]!.params.destination).toMatchObject({ split: 'right', target_pane_id: 'w1:p2' })
    expect(steps.slice(2)).toEqual([
      { method: 'pane.swap', params: { source_pane_id: 'w1:p3', target_pane_id: 'w1:p2' } },
      { method: 'pane.focus', params: { pane_id: 'w1:p1' } },
    ])
    // Le pane déplacé était le pane actif : rien à rendre après l'échange.
    expect(dropSteps({ ...s('w1:p3'), focused_pane_id: 'w1:p3' }, 'w1:p3', 'w1:p2', 'up').at(-1)!.method).toBe('pane.swap')
  })

  it('centre : échange ; refusé hors de l’onglet ou agrandi', () => {
    expect(dropSteps(s(), 'w1:p3', 'w1:p2', 'center')[0]).toEqual({ method: 'pane.swap', params: { source_pane_id: 'w1:p3', target_pane_id: 'w1:p2' } })
    expect(() => dropSteps(s(), 'w1:p3', 'w1:p9', 'left')).toThrow(/another tab/)
    expect(() => dropSteps(s(), 'w1:p3', 'w1:p3', 'left')).toThrow(/same pane/)
    const z = s()
    z.layouts[0] = { ...z.layouts[0]!, zoomed: true } as typeof z.layouts[0]
    expect(() => dropSteps(z, 'w1:p3', 'w1:p2', 'right')).toThrow(/zoomed/)
  })
})
