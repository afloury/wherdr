import { describe, expect, it } from 'vitest'
import { EDGE_MAX_SPEED, edgeLines, edgeScrollSpeed, findShift, isTerminalCopyKey, ownsDrag, selectionText, visibleRange } from '../app/utils/terminalSelection'

const key = (mods: Partial<Parameters<typeof isTerminalCopyKey>[0]>) => ({
  key: 'c', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
})
const press = (mods: Partial<Parameters<typeof ownsDrag>[0]>) => ({ button: 0, detail: 1, shiftKey: false, altKey: false, ...mods })

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

describe('drag ownership', () => {
  it('takes plain and Shift drags when the program does not track the mouse', () => {
    expect(ownsDrag(press({}), false)).toBe(true)
    expect(ownsDrag(press({ shiftKey: true }), false)).toBe(true)
  })

  it('leaves the plain drag to a mouse-tracking program, Shift or Option still select', () => {
    expect(ownsDrag(press({}), true)).toBe(false)
    expect(ownsDrag(press({ shiftKey: true }), true)).toBe(true)
    expect(ownsDrag(press({ altKey: true }), true)).toBe(true)
  })

  it('leaves double clicks and other buttons to xterm', () => {
    expect(ownsDrag(press({ detail: 2 }), false)).toBe(false)
    expect(ownsDrag(press({ button: 2 }), false)).toBe(false)
  })
})

describe('edge auto-scroll', () => {
  // Area from 100 to 500 px, 20 px lines.
  it('does not scroll inside the area', () => {
    expect(edgeScrollSpeed(300, 100, 500, 20)).toBe(0)
    expect(edgeScrollSpeed(121, 100, 500, 20)).toBe(0)
    expect(edgeScrollSpeed(479, 100, 500, 20)).toBe(0)
  })

  it('scrolls up near the top and down near the bottom', () => {
    expect(edgeScrollSpeed(110, 100, 500, 20)).toBeGreaterThan(0)
    expect(edgeScrollSpeed(490, 100, 500, 20)).toBeLessThan(0)
  })

  it('goes faster the farther the pointer is past the edge, up to a cap', () => {
    const near = edgeScrollSpeed(95, 100, 500, 20)
    const far = edgeScrollSpeed(20, 100, 500, 20)
    expect(far).toBeGreaterThan(near)
    expect(-edgeScrollSpeed(560, 100, 500, 20)).toBeGreaterThan(-edgeScrollSpeed(505, 100, 500, 20))
    expect(edgeScrollSpeed(-5000, 100, 500, 20)).toBe(EDGE_MAX_SPEED)
    expect(edgeScrollSpeed(9000, 100, 500, 20)).toBe(-EDGE_MAX_SPEED)
  })

  it('turns a speed into whole lines, keeping the fraction', () => {
    expect(edgeLines(10, 50, 0, 20)).toEqual({ lines: 0, rest: 0.5 })
    expect(edgeLines(10, 50, 0.5, 20)).toEqual({ lines: 1, rest: 0 })
    expect(edgeLines(-40, 50, 0, 20)).toEqual({ lines: -2, rest: 0 })
    // Capped at less than one screen per step: the offset stays measurable.
    expect(edgeLines(EDGE_MAX_SPEED, 1000, 0, 20)).toEqual({ lines: 20, rest: 0 })
  })
})

describe('selected text', () => {
  const lines = new Map([[-2, 'alpha one'], [-1, 'beta two  '], [0, 'gamma three'], [1, 'delta']])
  it('joins the rows between the two points, whatever the drag direction', () => {
    expect(selectionText(lines, { row: -2, col: 6 }, { row: 0, col: 5 })).toBe('one\nbeta two\ngamma')
    expect(selectionText(lines, { row: 0, col: 5 }, { row: -2, col: 6 })).toBe('one\nbeta two\ngamma')
    expect(selectionText(lines, { row: 1, col: 0 }, { row: 1, col: 3 })).toBe('del')
  })

  it('drops the blank rows below the text', () => {
    expect(selectionText(lines, { row: 1, col: 0 }, { row: 4, col: 10 })).toBe('delta')
  })
})

describe('scroll measurement', () => {
  const screen = (from: number, rows = 6) => Array.from({ length: rows }, (_, i) => `line ${from + i}`)

  it('finds how far the text moved', () => {
    expect(findShift(screen(10), screen(10))).toBe(0)
    expect(findShift(screen(10), screen(7))).toBe(3) // towards the top of the history
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

})
