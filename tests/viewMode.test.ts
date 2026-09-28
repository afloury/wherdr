import { describe, expect, it } from 'vitest'
import { cellMode, showComposer, spaceTabControls, terminalAttachment, toggleViewMode, viewControls } from '../app/utils/viewMode'

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
  it('agent sans conversation : aucune commande', () => {
    const none = { selector: null, term: false, project: false }
    expect(viewControls({ ...base, chat: false, project: true })).toEqual(none)
    expect(viewControls({ ...base, desk: true, chat: false })).toEqual(none)
    expect(viewControls({ ...base, desk: true, cell: true, chat: false, live: false })).toEqual(none)
  })
  it('case sans le focus : garde son sélecteur', () => {
    expect(viewControls({ ...base, desk: true, cell: true, live: false })).toEqual({ selector: 'cell', term: false, project: false })
  })
})

describe('saisie du pane', () => {
  it.each(['term', 'mirror'] as const)('retire le champ sur ordinateur en mode %s', mode => {
    expect(showComposer({ desk: true, live: true, mode })).toBe(false)
    expect(terminalAttachment({ desk: true, live: true, mode, available: true })).toBe(true)
    expect(showComposer({ desk: false, live: true, mode })).toBe(true)
    expect(terminalAttachment({ desk: false, live: true, mode, available: true })).toBe(false)
  })
  it('garde le champ dans la conversation sur les deux appareils', () => {
    expect(showComposer({ desk: true, live: true, mode: 'chat' })).toBe(true)
    expect(showComposer({ desk: false, live: true, mode: 'chat' })).toBe(true)
    expect(terminalAttachment({ desk: true, live: true, mode: 'chat', available: true })).toBe(false)
  })
  it('garde le champ d’une case conversation sans le focus', () => {
    expect(showComposer({ desk: true, live: false, mode: 'chat', cell: true })).toBe(true)
    expect(showComposer({ desk: true, live: false, mode: 'mirror', cell: true })).toBe(false)
    expect(showComposer({ desk: true, live: false, mode: 'chat' })).toBe(false)
  })
  it('ne propose rien dans une case inactive ou hors ligne', () => {
    expect(showComposer({ desk: true, live: false, mode: 'mirror' })).toBe(false)
    expect(terminalAttachment({ desk: true, live: false, mode: 'mirror', available: true })).toBe(false)
    expect(terminalAttachment({ desk: true, live: true, mode: 'term', available: false })).toBe(false)
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

describe('cellMode', () => {
  it('garde le mode mémorisé du pane, focus ou non', () => {
    expect(cellMode({ chat: true, viewMode: 'term' })).toBe('mirror')
    expect(cellMode({ chat: true, viewMode: 'chat' })).toBe('chat')
    expect(cellMode({ chat: true, viewMode: 'project' })).toBe('chat')
  })
  it('sans conversation : toujours le miroir', () => {
    expect(cellMode({ chat: false, viewMode: 'chat' })).toBe('mirror')
  })
  it('changer le focus ne change le mode d’aucune case', () => {
    const modes: Record<string, 'chat' | 'term'> = { a: 'term', b: 'term', c: 'chat' }
    const show = () => Object.fromEntries(Object.entries(modes).map(([k, m]) => [k, cellMode({ chat: true, viewMode: m })]))
    const before = show()
    for (const _focus of ['a', 'b', 'c', 'a']) expect(show()).toEqual(before)
    expect(before).toEqual({ a: 'mirror', b: 'mirror', c: 'chat' })
  })
})
