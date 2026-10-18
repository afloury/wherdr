import { describe, expect, it } from 'vitest'
import { DESK_QUERY, PHONE_QUERY, enterSends, isDesk, isSlim, isTablet, listMode, provesHardwareKeyboard } from '../app/utils/layoutMode'

describe('layout by window size', () => {
  it('phones stay phones, in both orientations', () => {
    expect(isDesk(390, 844)).toBe(false)
    expect(isDesk(844, 390)).toBe(false)
    expect(isDesk(430, 932)).toBe(false)
  })
  it('iPads get the computer layout in both orientations', () => {
    for (const [w, h] of [[744, 1133], [1133, 744], [820, 1180], [1180, 820], [1024, 1366]]) expect(isDesk(w, h)).toBe(true)
  })
  it('slim below 1024 px: iPad portrait, not landscape or a computer', () => {
    expect(isSlim(744, 1133)).toBe(true)
    expect(isSlim(820, 1180)).toBe(true)
    expect(isSlim(1180, 820)).toBe(false)
    expect(isSlim(1440, 900)).toBe(false)
    expect(isSlim(390, 844)).toBe(false)
  })
  it('a large iPhone in landscape (932 × 430) keeps the docked computer layout, as before', () => {
    expect(isDesk(932, 430)).toBe(true)
    expect(isTablet(932, 430)).toBe(false)
    expect(isSlim(932, 430)).toBe(false)
    expect(isTablet(744, 1133)).toBe(true)
  })
  it('the CSS queries are complementary', () => {
    expect(DESK_QUERY).toContain('(min-width: 700px) and (min-height: 700px)')
    expect(PHONE_QUERY).toContain('(max-width: 899px) and (max-height: 699px)')
  })
})

describe('list mode', () => {
  it('phone, docked, rail, drawer', () => {
    expect(listMode({ desk: false, slim: false, collapsed: true, drawerOpen: true })).toBe('phone')
    expect(listMode({ desk: true, slim: false, collapsed: false, drawerOpen: true })).toBe('docked')
    expect(listMode({ desk: true, slim: false, collapsed: true, drawerOpen: false })).toBe('rail')
    expect(listMode({ desk: true, slim: true, collapsed: false, drawerOpen: false })).toBe('rail')
    expect(listMode({ desk: true, slim: true, collapsed: true, drawerOpen: true })).toBe('drawer')
  })
})

describe('Enter in the message field', () => {
  const base = { desk: true, touch: true, tablet: true, hardwareKeyboard: false, softKeyboard: false }
  it('sends on a computer, adds a line on a phone', () => {
    expect(enterSends({ ...base, touch: false, tablet: false })).toBe(true)
    expect(enterSends({ ...base, desk: false, tablet: false, hardwareKeyboard: true })).toBe(false)
  })
  it('iPad without proof of a hardware keyboard (floating keyboard, no viewport change): a line', () => {
    expect(enterSends(base)).toBe(false)
  })
  it('iPad with a proven hardware keyboard sends; the on-screen keyboard showing wins', () => {
    expect(enterSends({ ...base, hardwareKeyboard: true })).toBe(true)
    expect(enterSends({ ...base, hardwareKeyboard: true, softKeyboard: true })).toBe(false)
  })
  it('large iPhone in landscape: never sends, even with a hardware keyboard (as before)', () => {
    expect(enterSends({ ...base, tablet: false, hardwareKeyboard: true })).toBe(false)
  })
})

describe('hardware keyboard proof', () => {
  const k = (key: string, mods: Partial<{ metaKey: boolean, ctrlKey: boolean, altKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods })
  it('arrows, Escape, Tab and modifier chords prove it', () => {
    for (const key of ['ArrowLeft', 'ArrowDown', 'Escape', 'Tab']) expect(provesHardwareKeyboard(k(key))).toBe(true)
    expect(provesHardwareKeyboard(k('k', { metaKey: true }))).toBe(true)
  })
  it('letters, Enter and Backspace (sent by on-screen keyboards) do not', () => {
    for (const key of ['a', 'Enter', 'Backspace', ' ']) expect(provesHardwareKeyboard(k(key))).toBe(false)
  })
})
