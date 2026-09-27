// Étoile animée devant le verbe de Claude (t-0022) : séquence et cadence de
// Claude Code 2.1.x (relevées dans le binaire 2.1.283).
import { describe, expect, it } from 'vitest'
import { spinnerGlyph, SPINNER_FRAMES, SPINNER_MS, SPINNER_REST } from '../app/utils/spinner'

describe('étoile de Claude', () => {
  it('aller puis retour, extrêmes doublés', () => {
    expect(SPINNER_FRAMES.join('')).toBe('·✢✳✶✻✽✽✻✶✳✢·')
    expect(SPINNER_MS).toBe(120)
  })
  it('une image toutes les 120 ms, en boucle', () => {
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
  it('glyphe fixe si le système réduit les animations', () => {
    expect(SPINNER_REST).toBe('✻')
    for (const t of [0, 120, 600, 1000]) expect(spinnerGlyph(t, true)).toBe('✻')
  })
})
