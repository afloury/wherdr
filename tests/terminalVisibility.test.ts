import { describe, expect, it } from 'vitest'
import { readShowShells } from '../app/utils/terminalVisibility'

describe('Afficher les terminaux', () => {
  it('is enabled without a preference and keeps saved choices', () => {
    expect(readShowShells(null)).toBe(true)
    expect(readShowShells('1')).toBe(true)
    expect(readShowShells('0')).toBe(false)
  })
})
