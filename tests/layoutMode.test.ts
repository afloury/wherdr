import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESK_QUERY, PHONE_QUERY, SLIM_QUERY, TABLET_QUERY, TOUCH_TABLET_QUERY, enterSends, isDesk, isSlim, isTablet, isTouchTabletScreen, listMode, provesHardwareKeyboard } from '../app/utils/layoutMode'

// Minimal media query evaluator: comma = or, `and` between (feature: value).
interface Env { w: number, h: number, dw: number, dh: number, pointer: 'coarse' | 'fine' | 'none' }
function matches(query: string, e: Env): boolean {
  return query.split(',').some(part => part.trim().split(/\s+and\s+/).every((cond) => {
    const m = /^\(([a-z-]+): ([a-z0-9]+?)(px)?\)$/.exec(cond.trim())
    if (!m) throw new Error(`unsupported condition ${cond}`)
    const [, f, v] = m as unknown as [string, string, string]
    const n = Number(v)
    switch (f) {
      case 'min-width': return e.w >= n
      case 'max-width': return e.w <= n
      case 'min-height': return e.h >= n
      case 'max-height': return e.h <= n
      case 'min-device-width': return e.dw >= n
      case 'max-device-width': return e.dw <= n
      case 'min-device-height': return e.dh >= n
      case 'max-device-height': return e.dh <= n
      case 'pointer': return e.pointer === v
      default: throw new Error(`unsupported feature ${f}`)
    }
  }))
}

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
  it('the CSS queries are complementary and agree with the functions', () => {
    const steps = [320, 390, 600, 699, 700, 744, 820, 899, 900, 1023, 1024, 1180, 1440]
    for (const w of steps) for (const h of steps) for (const [dw, dh] of [[390, 844], [744, 1133], [1920, 1080]]) {
      for (const pointer of ['coarse', 'fine', 'none'] as const) {
        const e = { w, h, dw, dh, pointer }
        const screen = { width: dw, height: dh, coarse: pointer === 'coarse' }
        expect(matches(PHONE_QUERY, e), JSON.stringify(e)).toBe(!matches(DESK_QUERY, e))
        expect(matches(DESK_QUERY, e), JSON.stringify(e)).toBe(isDesk(w, h, screen))
        expect(matches(TABLET_QUERY, e), JSON.stringify(e)).toBe(isTablet(w, h, screen))
        expect(matches(SLIM_QUERY, e) && matches(DESK_QUERY, e), JSON.stringify(e)).toBe(isSlim(w, h, screen))
      }
    }
  })
  it('main.css uses exactly these queries', () => {
    const css = fs.readFileSync(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
    const layout = [...css.matchAll(/@media ([^{]+)\{/g)].map(m => m[1]!.trim()).filter(q => /699px|700px\) and/.test(q))
    expect(layout.length).toBeGreaterThan(10)
    for (const q of layout) expect([DESK_QUERY, PHONE_QUERY, TOUCH_TABLET_QUERY]).toContain(q)
  })
})

describe('touch tablet recognised by its screen (on-screen keyboard open)', () => {
  const ipadMini = { width: 744, height: 1133, coarse: true }
  const ipadAir = { width: 820, height: 1180, coarse: true }
  it('a touch screen with a short side of 700 px or more', () => {
    expect(isTouchTabletScreen(ipadMini)).toBe(true)
    expect(isTouchTabletScreen({ width: 390, height: 844, coarse: true })).toBe(false)
    expect(isTouchTabletScreen({ width: 1920, height: 1080, coarse: false })).toBe(false)
    expect(isTouchTabletScreen()).toBe(false)
  })
  it('iPad mini in portrait, window shortened by the keyboard: still the computer layout, slim', () => {
    expect(isDesk(744, 600)).toBe(false)
    expect(isDesk(744, 600, ipadMini)).toBe(true)
    expect(isSlim(744, 600, ipadMini)).toBe(true)
  })
  it('iPad in landscape with the keyboard: still a tablet (44 px targets)', () => {
    expect(isTablet(1180, 420, ipadAir)).toBe(true)
    expect(isSlim(1180, 420, ipadAir)).toBe(false)
  })
  it('iPadOS multitasking narrower than 700 px stays a phone layout', () => {
    expect(isDesk(590, 820, ipadAir)).toBe(false)
    expect(isDesk(375, 500, ipadAir)).toBe(false)
  })
  it('a small window on a computer (mouse) is unchanged', () => {
    const monitor = { width: 1920, height: 1080, coarse: false }
    expect(isDesk(800, 600, monitor)).toBe(false)
    expect(isTablet(800, 600, monitor)).toBe(false)
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
  it('sends in a narrow computer window too: no touch screen, no on-screen keyboard', () => {
    expect(enterSends({ ...base, desk: false, touch: false, tablet: false })).toBe(true)
  })
  it('a tablet in the phone layout adds a line, even with a hardware keyboard', () => {
    expect(enterSends({ ...base, desk: false, hardwareKeyboard: true })).toBe(false)
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
