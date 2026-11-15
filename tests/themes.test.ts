import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, storedThemeChoice } from '../app/utils/themes'

describe('storedThemeChoice', () => {
  it('keeps a known theme', () => {
    expect(storedThemeChoice('dracula')).toBe('dracula')
  })
  it('falls back to the default for the removed "Follow Herdr" choice and unknown ids', () => {
    expect(storedThemeChoice('follow')).toBe(DEFAULT_THEME)
    expect(storedThemeChoice('gone-theme')).toBe(DEFAULT_THEME)
    expect(storedThemeChoice(null)).toBe(DEFAULT_THEME)
  })
})
