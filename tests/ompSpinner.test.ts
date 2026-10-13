// omp's braille spinner and elapsed time in the conversation (t-0182).
import { describe, expect, it } from 'vitest'
import { OMP_SPINNER_FRAMES, OMP_SPINNER_MS, OMP_SPINNER_REST, ompElapsed, ompSpinnerDelay, ompSpinnerGlyph } from '../app/utils/ompSpinner'

describe('omp spinner', () => {
  it('ten braille frames, one every 80 ms, looping', () => {
    expect(OMP_SPINNER_FRAMES.join('')).toBe('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏')
    expect(ompSpinnerGlyph(0)).toBe('⠋')
    expect(ompSpinnerGlyph(OMP_SPINNER_MS - 1)).toBe('⠋')
    expect(ompSpinnerGlyph(OMP_SPINNER_MS)).toBe('⠙')
    expect(ompSpinnerGlyph(9 * OMP_SPINNER_MS)).toBe('⠏')
    expect(ompSpinnerGlyph(10 * OMP_SPINNER_MS)).toBe('⠋')
    expect(ompSpinnerGlyph(-5)).toBe('⠋')
  })
  it('fixed glyph if the system reduces motion', () => {
    for (const t of [0, 80, 400]) expect(ompSpinnerGlyph(t, true)).toBe(OMP_SPINNER_REST)
  })
  it('elapsed time written like omp', () => {
    expect(ompElapsed(1000, 1000)).toBe('0s')
    expect(ompElapsed(0, 47_900)).toBe('47s')
    expect(ompElapsed(0, 125_000)).toBe('2m 5s')
    expect(ompElapsed(0, 3_780_000)).toBe('1h 3m')
    expect(ompElapsed(5000, 1000)).toBe('0s')
  })
  it('no timer on a hidden page; once a second for the time with reduced motion', () => {
    expect(ompSpinnerDelay(false, true)).toBe(OMP_SPINNER_MS)
    expect(ompSpinnerDelay(true, true)).toBe(1000)
    expect(ompSpinnerDelay(false, false)).toBeNull()
    expect(ompSpinnerDelay(true, false)).toBeNull()
  })
})
