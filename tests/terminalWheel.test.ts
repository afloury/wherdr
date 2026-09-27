import { describe, expect, it } from 'vitest'
import { takeLines, wheelPixels } from '../app/utils/terminalWheel'

describe('wheelPixels', () => {
  it('garde les pixels tels quels', () => {
    expect(wheelPixels(-100, 0, 16, 40)).toBe(-100)
  })
  it('convertit les lignes (Firefox) et les pages', () => {
    expect(wheelPixels(3, 1, 16, 40)).toBe(48)
    expect(wheelPixels(-1, 2, 16, 40)).toBe(-640)
  })
})

describe('takeLines', () => {
  it('rend des lignes entières et garde le reste', () => {
    expect(takeLines(50, 16)).toEqual({ lines: 3, rest: 2 })
    expect(takeLines(-50, 16)).toEqual({ lines: -3, rest: -2 })
  })
  it('ne fait rien sous une ligne', () => {
    expect(takeLines(10, 16)).toEqual({ lines: 0, rest: 10 })
  })
  it('se protège d’une hauteur de ligne nulle', () => {
    expect(takeLines(32, 0)).toEqual({ lines: 2, rest: 0 })
  })
})
