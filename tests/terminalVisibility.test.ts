import { describe, expect, it } from 'vitest'
import { readShowShells, repoHeaderState, threadCountLabel } from '../app/utils/terminalVisibility'

describe('Afficher les terminaux', () => {
  it('est activé sans préférence et conserve les choix enregistrés', () => {
    expect(readShowShells(null)).toBe(true)
    expect(readShowShells('1')).toBe(true)
    expect(readShowShells('0')).toBe(false)
  })

  it('propose le terminal de l’en-tête Dépôt dans un menu seulement si les terminaux sont affichés', () => {
    expect(repoHeaderState(true, false)).toEqual({ menu: true, selected: false })
    expect(repoHeaderState(true, true)).toEqual({ menu: true, selected: true })
    expect(repoHeaderState(false, true)).toEqual({ menu: false, selected: false })
  })

  it('n’a pas de menu sans terminal racine', () => {
    expect(repoHeaderState(true, true, false)).toEqual({ menu: false, selected: false })
  })
})

describe('Nombre de threads', () => {
  it('accorde singulier et pluriel', () => {
    expect(threadCountLabel(1)).toBe('1 thread')
    expect(threadCountLabel(0)).toBe('0 threads')
    expect(threadCountLabel(3)).toBe('3 threads')
  })
})
