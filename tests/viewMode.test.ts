import { describe, expect, it } from 'vitest'
import { spaceTabControls, toggleViewMode, viewControls } from '../app/utils/viewMode'

const base = { desk: false, cell: false, chat: true, live: true, project: false }

describe('viewControls', () => {
  it('téléphone : bascule terminal dans l’en-tête, pas de sélecteur', () => {
    expect(viewControls(base)).toEqual({ selector: null, term: true, project: false })
  })
  it('téléphone, coordinateur : bascule Projet en plus', () => {
    expect(viewControls({ ...base, project: true })).toEqual({ selector: null, term: true, project: true })
  })
  it('ordinateur : sélecteur dans l’en-tête, ou dans l’en-tête de la case', () => {
    expect(viewControls({ ...base, desk: true, project: true })).toEqual({ selector: 'header', term: false, project: false })
    expect(viewControls({ ...base, desk: true, cell: true })).toEqual({ selector: 'cell', term: false, project: false })
  })
  it('agent sans conversation ou case inactive : aucune commande', () => {
    const none = { selector: null, term: false, project: false }
    expect(viewControls({ ...base, chat: false, project: true })).toEqual(none)
    expect(viewControls({ ...base, desk: true, chat: false })).toEqual(none)
    expect(viewControls({ ...base, desk: true, cell: true, live: false })).toEqual(none)
  })
})

describe('spaceTabControls', () => {
  it('place le + dans l’en-tête pour un seul onglet', () => {
    expect(spaceTabControls(1)).toEqual({ row: false, headerAdd: true })
  })
  it('place la rangée et son + avant l’en-tête pour plusieurs onglets', () => {
    expect(spaceTabControls(2)).toEqual({ row: true, headerAdd: false })
    expect(spaceTabControls(3)).toEqual({ row: true, headerAdd: false })
  })
  it('attend l’état du space avant de montrer des commandes', () => {
    expect(spaceTabControls(0)).toEqual({ row: false, headerAdd: false })
  })
})

describe('toggleViewMode', () => {
  it('affiche la cible, puis revient à la conversation', () => {
    expect(toggleViewMode('chat', 'term')).toBe('term')
    expect(toggleViewMode('term', 'term')).toBe('chat')
    expect(toggleViewMode('project', 'term')).toBe('term')
    expect(toggleViewMode('term', 'project')).toBe('project')
    expect(toggleViewMode('project', 'project')).toBe('chat')
  })
})
