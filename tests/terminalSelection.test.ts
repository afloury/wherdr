import { describe, expect, it } from 'vitest'
import { findShift, isTerminalCopyKey, selectionIntact, shiftDragPress, visibleRange } from '../app/utils/terminalSelection'

const key = (mods: Partial<Parameters<typeof isTerminalCopyKey>[0]>) => ({
  key: 'c', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
})
const press = (mods: Partial<Parameters<typeof shiftDragPress>[0]>) => ({ button: 0, shiftKey: false, altKey: false, ...mods })

describe('terminal copy shortcut', () => {
  it('accepts Command+C and Ctrl+Shift+C', () => {
    expect(isTerminalCopyKey(key({ metaKey: true }))).toBe(true)
    expect(isTerminalCopyKey(key({ ctrlKey: true, shiftKey: true }))).toBe(true)
    expect(isTerminalCopyKey(key({ key: 'C', ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it('leaves Ctrl+C and Option+C to the running program', () => {
    expect(isTerminalCopyKey(key({ ctrlKey: true }))).toBe(false)
    expect(isTerminalCopyKey(key({ altKey: true, metaKey: true }))).toBe(false)
    expect(isTerminalCopyKey(key({ key: 'v', metaKey: true }))).toBe(false)
  })
})

describe('Shift + drag', () => {
  it('starts a new selection instead of extending a missing one', () => {
    expect(shiftDragPress(press({ shiftKey: true }), true, false)).toEqual({ shiftKey: false, altKey: false })
    expect(shiftDragPress(press({ shiftKey: true }), false, false)).toEqual({ shiftKey: false, altKey: false })
  })

  it('forces the selection with Option on a Mac when the program has the mouse', () => {
    expect(shiftDragPress(press({ shiftKey: true }), true, true)).toEqual({ shiftKey: false, altKey: true })
    // Ailleurs, xterm force déjà la sélection avec Shift.
    expect(shiftDragPress(press({ shiftKey: true }), false, true)).toBeNull()
  })

  it('leaves plain, Option and non-primary presses alone', () => {
    expect(shiftDragPress(press({}), true, true)).toBeNull()
    expect(shiftDragPress(press({ altKey: true }), true, true)).toBeNull()
    expect(shiftDragPress(press({ shiftKey: true, altKey: true }), true, false)).toBeNull()
    expect(shiftDragPress(press({ shiftKey: true, button: 2 }), true, false)).toBeNull()
  })
})

describe('selection follows scrolled text', () => {
  const screen = (from: number, rows = 6) => Array.from({ length: rows }, (_, i) => `line ${from + i}`)

  it('finds how far the text moved', () => {
    expect(findShift(screen(10), screen(10))).toBe(0)
    expect(findShift(screen(10), screen(7))).toBe(3) // vers le haut de l'historique
    expect(findShift(screen(10), screen(12))).toBe(-2)
  })

  it('gives up on unrelated screens', () => {
    expect(findShift(screen(10), screen(100))).toBeNull()
    expect(findShift(screen(10), ['', '', '', '', '', ''])).toBeNull()
  })

  it('prefers the expected shift on repetitive screens', () => {
    const same = ['a', 'b', 'a', 'b', 'a', 'b']
    expect(findShift(same, same, 2)).toBe(2)
    expect(findShift(same, same)).toBe(0)
  })

  it('clips a moved selection to the screen', () => {
    const sel = { startX: 4, startY: 1, endX: 3, endY: 2 }
    expect(visibleRange(sel, 10, 6)).toEqual({ column: 4, row: 1, length: 9 })
    expect(visibleRange({ ...sel, startY: -1, endY: 0 }, 10, 6)).toEqual({ column: 0, row: 0, length: 3 })
    expect(visibleRange({ ...sel, startY: 5, endY: 6 }, 10, 6)).toEqual({ column: 4, row: 5, length: 6 })
    expect(visibleRange({ ...sel, startY: -3, endY: -2 }, 10, 6)).toBeNull()
    expect(visibleRange({ ...sel, startY: 6, endY: 7 }, 10, 6)).toBeNull()
  })

  it('checks the highlighted text is still the selected one', () => {
    const sel = { startX: 0, startY: 2, endX: 4, endY: 3, text: '', lines: ['line 12', 'line 13'] }
    expect(selectionIntact(sel, screen(10))).toBe(true)
    expect(selectionIntact(sel, screen(11))).toBe(false)
    expect(selectionIntact({ ...sel, startY: -1 }, ['line 13  ', 'x', 'x'])).toBe(true)
  })
})
