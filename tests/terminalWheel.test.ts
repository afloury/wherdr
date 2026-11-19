import { describe, expect, it } from 'vitest'
import { takeLines, wheelPixels, wheelReports } from '../app/utils/terminalWheel'

describe('wheelPixels', () => {
  it('garde les pixels tels quels', () => {
    expect(wheelPixels(-100, 0, 16, 40)).toBe(-100)
  })
  it('converts lines (Firefox) and pages', () => {
    expect(wheelPixels(3, 1, 16, 40)).toBe(48)
    expect(wheelPixels(-1, 2, 16, 40)).toBe(-640)
  })
})

describe('takeLines', () => {
  it('returns whole lines and keeps the remainder', () => {
    expect(takeLines(50, 16)).toEqual({ lines: 3, rest: 2 })
    expect(takeLines(-50, 16)).toEqual({ lines: -3, rest: -2 })
  })
  it('does nothing below one line', () => {
    expect(takeLines(10, 16)).toEqual({ lines: 0, rest: 10 })
  })
  it('guards against a zero line height', () => {
    expect(takeLines(32, 0)).toEqual({ lines: 2, rest: 0 })
  })
})

describe('wheelReports', () => {
  it('sends one SGR report per line, up (64) or down (65), at a 1-based cell', () => {
    expect(wheelReports(2, { column: 4, row: 9 }, true)).toBe('\x1b[<64;5;10M\x1b[<64;5;10M')
    expect(wheelReports(-1, { column: 0, row: 0 }, true)).toBe('\x1b[<65;1;1M')
  })
  it('falls back to X10 bytes, coordinates capped at 223, and bounds the count', () => {
    expect(wheelReports(1, { column: 4, row: 300 }, false)).toBe('\x1b[M`%\xff')
    expect(wheelReports(-500, { column: 0, row: 0 }, true, 3)).toBe('\x1b[<65;1;1M'.repeat(3))
    expect(wheelReports(0, { column: 0, row: 0 }, true)).toBe('')
  })
})
