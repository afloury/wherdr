import { describe, expect, it } from 'vitest'
import { applyMove, readyLists, reorderTarget, reorderWorkspaces } from '../shared/spaces'
import type { Row } from '../shared/spaces'

// Ordre Herdr de la machine : w1..w6. Groupe affiché « Prêts » : w2, w4, w5
// (w1, w3, w6 sont dans d'autres groupes).
const ORDER = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']
const GROUP = ['w2', 'w4', 'w5']

const row = (key: string, status: 'done' | 'idle'): Row => ({
  kind: 'pane', key, pane: { id: key, agent: 'claude', status } as Row['lead'],
  lead: { id: key, agent: 'claude', status } as Row['lead'],
})

describe('readyLists', () => {
  const rows = [row('w2', 'idle'), row('w4', 'done'), row('w5', 'idle'), row('w6', 'done')]

  it('place les non lus en tête, en conservant l’ordre Herdr dans chaque sous-groupe', () => {
    expect(readyLists(rows, true).map(list => list.map(r => r.key))).toEqual([['w4', 'w6'], ['w2', 'w5']])
  })

  it('laisse l’ordre Herdr quand le réglage est désactivé', () => {
    expect(readyLists(rows, false).map(list => list.map(r => r.key))).toEqual([['w2', 'w4', 'w5', 'w6']])
  })

  it('considère non lu un space contenant un pane terminé', () => {
    const space = { kind: 'space', key: 'space', lead: row('lead', 'idle').lead,
      panes: [row('read', 'idle').lead, row('unread', 'done').lead] } as Row
    expect(readyLists([rows[0]!, space], true).map(list => list.map(r => r.key))).toEqual([['space'], ['w2']])
  })

  it('ne crée pas de sous-groupe vide', () => {
    expect(readyLists([row('w2', 'idle')], true).map(list => list.map(r => r.key))).toEqual([['w2']])
  })
})

describe('applyMove', () => {
  it('place avant un espace, ou à la fin', () => {
    expect(applyMove(ORDER, 'w5', 'w2')).toEqual(['w1', 'w5', 'w2', 'w3', 'w4', 'w6'])
    expect(applyMove(ORDER, 'w1', null)).toEqual(['w2', 'w3', 'w4', 'w5', 'w6', 'w1'])
    expect(applyMove(ORDER, 'w1', 'w9')).toEqual(['w2', 'w3', 'w4', 'w5', 'w6', 'w1'])
  })
})

describe('reorderTarget', () => {
  it('borne le dépôt au sous-groupe actif et applique le placement Herdr habituel', () => {
    const order = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']
    const unread = ['w2', 'w4']
    const read = ['w3', 'w5']
    expect(reorderTarget(order, unread, 'w4', 0)).toEqual({ before: 'w2' })
    expect(reorderTarget(order, read, 'w3', 2)).toEqual({ before: 'w6' })
    expect(reorderTarget(order, unread, 'w3', 1)).toBeNull()
  })
  it('en tête du groupe : juste avant la première carte', () => {
    expect(reorderTarget(ORDER, GROUP, 'w5', 0)).toEqual({ before: 'w2' })
  })

  it('entre deux cartes : avant celle du dessous, en descendant comme en montant', () => {
    expect(reorderTarget(ORDER, GROUP, 'w2', 2)).toEqual({ before: 'w5' })
    expect(reorderTarget(ORDER, GROUP, 'w5', 1)).toEqual({ before: 'w4' })
  })

  it('en bas du groupe : juste après la dernière (avant l’espace qui la suit dans Herdr)', () => {
    expect(reorderTarget(ORDER, GROUP, 'w2', 3)).toEqual({ before: 'w6' })
    expect(reorderTarget(ORDER, ['w2', 'w6'], 'w2', 2)).toEqual({ before: null })
  })

  it('rien quand la carte reste à sa place', () => {
    expect(reorderTarget(ORDER, GROUP, 'w4', 1)).toBeNull()
    expect(reorderTarget(ORDER, GROUP, 'w4', 2)).toBeNull()
    expect(reorderTarget(ORDER, ['w2'], 'w2', 0)).toBeNull()
    expect(reorderTarget(ORDER, GROUP, 'w9', 0)).toBeNull()
  })

  it('les espaces des autres groupes gardent leur ordre relatif', () => {
    const t = reorderTarget(ORDER, GROUP, 'w5', 0)!
    const next = applyMove(ORDER, 'w5', t.before)
    expect(next.filter(id => !GROUP.includes(id))).toEqual(['w1', 'w3', 'w6'])
    expect(next.filter(id => GROUP.includes(id))).toEqual(['w5', 'w2', 'w4'])
  })
})

describe('reorderWorkspaces', () => {
  it('renumérote la machine de l’espace seulement', () => {
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
