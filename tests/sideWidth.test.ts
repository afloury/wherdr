import { describe, expect, it } from 'vitest'
import { LIST_MAX, LIST_MIN, SIDE_MIN, clampListWidth, clampSideWidth, listWidthCss } from '../app/utils/sideWidth'

describe('largeur de la colonne Projet', () => {
  it('clamped between 260 px and half the area', () => {
    expect(clampSideWidth(100, 1100)).toBe(SIDE_MIN)
    expect(clampSideWidth(420.4, 1100)).toBe(420)
    expect(clampSideWidth(900, 1100)).toBe(550)
  })
  it('narrow area: the minimum wins', () => {
    expect(clampSideWidth(400, 480)).toBe(SIDE_MIN)
  })
})

describe('sidebar width (list)', () => {
  it('clamped between 280 and 560 px', () => {
    expect(clampListWidth(100, 1600)).toBe(LIST_MIN)
    expect(clampListWidth(412.6, 1600)).toBe(413)
    expect(clampListWidth(900, 1600)).toBe(LIST_MAX)
  })
  it('at most 45 % of the window; narrow window: the minimum wins', () => {
    expect(clampListWidth(560, 1000)).toBe(450)
    expect(clampListWidth(500, 500)).toBe(LIST_MIN)
  })
  it('CSS value also clamped if the window shrinks', () => {
    expect(listWidthCss(400)).toBe('clamp(280px, 400px, 45vw)')
  })
})
