import { describe, expect, it } from 'vitest'
import { type RefreshInput, refreshMode } from '../app/utils/projectRefresh'

const base: RefreshInput = { coordinator: true, offline: false, visible: true, pageVisible: true, available: null }

describe('panneau Projet : quand lire', () => {
  it('rechargement : rien pendant l’état hors ligne, lecture dès l’état en direct', () => {
    // Dernier état gardé affiché au rechargement : pane connu, mais hors ligne.
    expect(refreshMode({ ...base, offline: true })).toBe('none')
    // L'état en direct arrive : on lit tout de suite (plus d'attente du sondage).
    expect(refreshMode(base)).toBe('poll')
  })

  it('état pas encore reçu : lecture dès que le pane devient un coordinateur connu', () => {
    expect(refreshMode({ ...base, coordinator: false })).toBe('none')
    expect(refreshMode(base)).toBe('poll')
  })

  it('panneau caché : une lecture pour savoir s’il faut montrer l’onglet, puis plus rien', () => {
    expect(refreshMode({ ...base, visible: false })).toBe('probe')
    expect(refreshMode({ ...base, visible: false, available: true })).toBe('none')
    expect(refreshMode({ ...base, visible: true, available: true })).toBe('poll')
  })

  it('pas de herdr-projects, ou page cachée : aucune lecture', () => {
    expect(refreshMode({ ...base, available: false })).toBe('none')
    expect(refreshMode({ ...base, pageVisible: false })).toBe('none')
  })
})
