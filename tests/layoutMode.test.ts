import { describe, expect, it } from 'vitest'
import { DESK_QUERY, PHONE_QUERY, enterSends, isDesk, isSlim, listMode } from '../app/utils/layoutMode'

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
  it('sends on a computer, adds a line on a phone', () => {
    expect(enterSends({ desk: true, touch: false, softKeyboard: false })).toBe(true)
    expect(enterSends({ desk: false, touch: true, softKeyboard: false })).toBe(false)
  })
  it('iPad: sends with a hardware keyboard, adds a line with the on-screen one', () => {
    expect(enterSends({ desk: true, touch: true, softKeyboard: false })).toBe(true)
    expect(enterSends({ desk: true, touch: true, softKeyboard: true })).toBe(false)
  })
})
