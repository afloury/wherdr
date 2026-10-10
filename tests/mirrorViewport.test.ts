import { describe, expect, it } from 'vitest'
import { MIRROR_MIN_FONT, mirrorFit, mirrorFontSize, mirrorLeft, mirrorTop } from '../app/utils/mirrorViewport'

describe('position du miroir', () => {
  it('keeps a top margin if the terminal fits in the cell', () => {
    expect(mirrorTop(300, 250, 24, 25)).toBe(6)
  })

  it('frames on the cursor without shrinking the text', () => {
    expect(mirrorTop(120, 250, 0, 25)).toBe(6)
    expect(mirrorTop(120, 250, 20, 25)).toBe(-96)
    expect(mirrorTop(120, 250, 24, 25)).toBe(-136)
  })
})

describe('mirror in its cell', () => {
  // JetBrains Mono: a character is 0.6 of the font size wide.
  const RATIO = 0.6

  it('keeps the setting\'s font size when the screen fits', () => {
    // 80 columns of 7.2 px in a cell of 1030 px (the reported case).
    expect(mirrorFontSize(1030, 80, RATIO, 12)).toBe(12)
    expect(mirrorFontSize(592, 80, RATIO, 12)).toBe(12)
  })

  it('shrinks the characters of a screen wider than the cell until it fits', () => {
    const size = mirrorFontSize(700, 113, RATIO, 12)
    expect(size).toBeLessThan(12)
    expect(size).toBeGreaterThanOrEqual(MIRROR_MIN_FONT)
    expect(113 * RATIO * size).toBeLessThanOrEqual(700 - 16)
    // By tenths of a pixel: the largest size that fits.
    expect(113 * RATIO * (size + 0.1)).toBeGreaterThan(700 - 16)
  })

  it('never goes below a readable size, nor above the setting', () => {
    expect(mirrorFontSize(300, 300, RATIO, 12)).toBe(MIRROR_MIN_FONT)
    expect(mirrorFontSize(300, 300, RATIO, 7)).toBe(7)
    expect(mirrorFontSize(5000, 20, RATIO, 14)).toBe(14)
    // Nothing measured yet.
    expect(mirrorFontSize(0, 80, RATIO, 12)).toBe(12)
    expect(mirrorFontSize(800, 80, 0, 12)).toBe(12)
  })

  it('centres a screen narrower than its cell', () => {
    expect(mirrorLeft(1030, 576)).toBe(227)
    expect(mirrorLeft(600, 592)).toBe(8)
    // Wider (cropped): from the left edge.
    expect(mirrorLeft(400, 592)).toBe(8)
  })

  it('columns and rows that fill a cell', () => {
    expect(mirrorFit(817, 1012, 7.2, 16)).toEqual({ cols: 111, rows: 62 })
    expect(mirrorFit(60, 40, 7.2, 16)).toEqual({ cols: 10, rows: 5 })
    expect(mirrorFit(817, 1012, 0, 16)).toBeNull()
  })
})
