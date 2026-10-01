// Animated star in front of Claude's verb (t-0022): sequence and rate of
// Claude Code 2.1.x (taken from the 2.1.283 binary).
import { describe, expect, it } from 'vitest'
import { spinnerGlyph, SPINNER_FRAMES, SPINNER_MS, SPINNER_REST } from '../app/utils/spinner'

describe('Claude star', () => {
  it('forward then back, extremes doubled', () => {
    expect(SPINNER_FRAMES.join('')).toBe('·✢✳✶✻✽✽✻✶✳✢·')
    expect(SPINNER_MS).toBe(120)
  })
  it('one frame every 120 ms, looping', () => {
    expect(spinnerGlyph(0)).toBe('·')
    expect(spinnerGlyph(119)).toBe('·')
    expect(spinnerGlyph(120)).toBe('✢')
    expect(spinnerGlyph(5 * 120)).toBe('✽')
    expect(spinnerGlyph(6 * 120)).toBe('✽')
    expect(spinnerGlyph(11 * 120)).toBe('·')
    expect(spinnerGlyph(12 * 120)).toBe('·')
    expect(spinnerGlyph(13 * 120 + 50)).toBe('✢')
    expect(spinnerGlyph(-5)).toBe('·')
  })
  it('fixed glyph if the system reduces motion', () => {
    expect(SPINNER_REST).toBe('✻')
    for (const t of [0, 120, 600, 1000]) expect(spinnerGlyph(t, true)).toBe('✻')
  })
})
