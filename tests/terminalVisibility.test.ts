import { describe, expect, it } from 'vitest'
import { readShowShells, repoHeaderState, threadCountLabel } from '../app/utils/terminalVisibility'

describe('Afficher les terminaux', () => {
  it('is enabled without a preference and keeps saved choices', () => {
    expect(readShowShells(null)).toBe(true)
    expect(readShowShells('1')).toBe(true)
    expect(readShowShells('0')).toBe(false)
  })

  it('offers the Repository header terminal in a menu only if terminals are shown', () => {
    expect(repoHeaderState(true, false)).toEqual({ menu: true, selected: false })
    expect(repoHeaderState(true, true)).toEqual({ menu: true, selected: true })
    expect(repoHeaderState(false, true)).toEqual({ menu: false, selected: false })
  })

  it('has no menu without a root terminal', () => {
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
