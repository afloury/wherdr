import { describe, expect, it } from 'vitest'
import { headerFold } from '../app/utils/headerFold'

describe('headerFold', () => {
  it('keeps every button when the row is wide enough', () => {
    expect(headerFold(400, 5, 3)).toBe(0)
  })
  it('folds just enough buttons for the minimum sidebar width', () => {
    // 280 px sidebar minus 32 px padding plus the 6 px edge: 5 buttons do not fit.
    const k = headerFold(254, 5, 3)
    expect(k).toBeGreaterThan(0)
    // The visible buttons plus "…" fit beside the minimum title width.
    expect((5 - k + 1) * 44 - 4 - 6).toBeLessThanOrEqual(254 - 12 - 104)
    // One fewer folded button would not fit.
    expect((5 - k + 2) * 44 - 4 - 6).toBeGreaterThan(254 - 12 - 104)
  })
  it('never folds a single button into a menu of one when folding does not help', () => {
    // Folding one button replaces it with "…": same count, so it folds at least two.
    expect(headerFold(200, 4, 2)).not.toBe(1)
  })
  it('stops at the number of foldable buttons', () => {
    expect(headerFold(100, 5, 3)).toBe(3)
  })
})
