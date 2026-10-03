import { describe, expect, it, vi } from 'vitest'
import { copyTerminalText, isTerminalCopyKey, shiftDragPress, trimSelection } from '../app/utils/terminalSelection'

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
    // Elsewhere, xterm already forces the selection with Shift.
    expect(shiftDragPress(press({ shiftKey: true }), false, true)).toBeNull()
  })

  it('leaves plain, Option and non-primary presses alone', () => {
    expect(shiftDragPress(press({}), true, true)).toBeNull()
    expect(shiftDragPress(press({ altKey: true }), true, true)).toBeNull()
    expect(shiftDragPress(press({ shiftKey: true, altKey: true }), true, false)).toBeNull()
    expect(shiftDragPress(press({ shiftKey: true, button: 2 }), true, false)).toBeNull()
  })
})

describe('copy of the selection', () => {
  it('drops the blanks Herdr paints at the end of each line', () => {
    expect(trimSelection('line 1   \nline 2\t \n  indented  ')).toBe('line 1\nline 2\n  indented')
  })

  it('writes the text synchronously, inside the gesture', async () => {
    const writeText = vi.fn(async () => {})
    const done = copyTerminalText('hello', { writeText })
    // Called before any await: the release or key press still counts as a gesture.
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(await done).toBe(true)
  })

  it('does nothing without a selection or a clipboard', async () => {
    const writeText = vi.fn(async () => {})
    expect(await copyTerminalText('', { writeText })).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    expect(await copyTerminalText('hello', undefined)).toBe(false)
  })

  it('reports a refused write as false, without throwing', async () => {
    expect(await copyTerminalText('hello', { writeText: () => Promise.reject(new Error('denied')) })).toBe(false)
    expect(await copyTerminalText('hello', { writeText: () => { throw new Error('denied') } })).toBe(false)
  })
})
