import { describe, expect, it } from 'vitest'
import { LIST_MAX, LIST_MIN, SIDE_MIN, clampListWidth, clampSideWidth, listWidthCss } from '../app/utils/sideWidth'

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

describe('largeur de la barre latérale (liste)', () => {
  it('bornée entre 280 et 560 px', () => {
    expect(clampListWidth(100, 1600)).toBe(LIST_MIN)
    expect(clampListWidth(412.6, 1600)).toBe(413)
    expect(clampListWidth(900, 1600)).toBe(LIST_MAX)
  })
  it('45 % de la fenêtre au plus ; fenêtre étroite : le minimum l’emporte', () => {
    expect(clampListWidth(560, 1000)).toBe(450)
    expect(clampListWidth(500, 500)).toBe(LIST_MIN)
  })
  it('valeur CSS bornée aussi si la fenêtre rétrécit', () => {
    expect(listWidthCss(400)).toBe('clamp(280px, 400px, 45vw)')
  })
})
