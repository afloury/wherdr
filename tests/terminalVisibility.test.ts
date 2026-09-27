import { describe, expect, it } from 'vitest'
import { readShowShells, repoHeaderState } from '../app/utils/terminalVisibility'

describe('Afficher les terminaux', () => {
  it('est activé sans préférence et conserve les choix enregistrés', () => {
    expect(readShowShells(null)).toBe(true)
    expect(readShowShells('1')).toBe(true)
    expect(readShowShells('0')).toBe(false)
  })

  it('rend l’en-tête Dépôt interactif seulement si les terminaux sont affichés', () => {
    expect(repoHeaderState(true, false)).toEqual({ tag: 'button', selected: false })
    expect(repoHeaderState(true, true)).toEqual({ tag: 'button', selected: true })
    expect(repoHeaderState(false, true)).toEqual({ tag: 'div', selected: false })
  })
})
