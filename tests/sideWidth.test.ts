import { describe, expect, it } from 'vitest'
import { SIDE_MIN, clampSideWidth } from '../app/utils/sideWidth'

describe('largeur de la colonne Projet', () => {
  it('bornée entre 260 px et la moitié de la zone', () => {
    expect(clampSideWidth(100, 1100)).toBe(SIDE_MIN)
    expect(clampSideWidth(420.4, 1100)).toBe(420)
    expect(clampSideWidth(900, 1100)).toBe(550)
  })
  it('zone étroite : le minimum l’emporte', () => {
    expect(clampSideWidth(400, 480)).toBe(SIDE_MIN)
  })
})
