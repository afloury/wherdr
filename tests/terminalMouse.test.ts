// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { bindTerminalMouse } from '../app/utils/terminalMouse'

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })
function setup(enabled = true) {
  const root = document.createElement('div')
  root.innerHTML = '<div class="xterm-screen"></div>'
  document.body.append(root)
  vi.spyOn(root.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 800, height: 400 } as DOMRect)
  const send = vi.fn()
  const term = { element: root, cols: 80, rows: 20, focus: vi.fn(), clearSelection: vi.fn() } as unknown as Terminal
  const binding = bindTerminalMouse(term, () => enabled, send)
  const dispatch = (type: string, init: PointerEventInit = {}, target: EventTarget = root.firstElementChild!) => {
    const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 45, clientY: 65, pointerId: 1, pointerType: 'mouse', button: 0, ...init })
    target.dispatchEvent(e)
    return e
  }
  return { binding, dispatch, send, term, root }
}

describe('structured terminal mouse input', () => {
  it('sends a drag and release in screen cells even when released outside', () => {
    const { binding, dispatch, send } = setup()
    expect(dispatch('pointerdown').defaultPrevented).toBe(true)
    dispatch('pointermove', { clientX: 65, clientY: 85 }, window)
    dispatch('pointerup', { clientX: 900 }, window)
    expect(send.mock.calls.map(c => c[0])).toEqual([
      { type: 'terminal.mouse', action: 'down', button: 'left', column: 3, row: 2, modifiers: 0 },
      { type: 'terminal.mouse', action: 'drag', button: 'left', column: 5, row: 3, modifiers: 0 },
      { type: 'terminal.mouse', action: 'up', button: 'left', column: 79, row: 2, modifiers: 0 },
    ])
    binding.dispose()
    dispatch('pointerdown')
    expect(send).toHaveBeenCalledTimes(3)
  })
  it('leaves Shift selection, modified links and touch scrolling alone', () => {
    const { binding, dispatch, send } = setup()
    for (const init of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { pointerType: 'touch' }]) {
      expect(dispatch('pointerdown', init).defaultPrevented).toBe(false)
      dispatch('pointerup', init)
    }
    expect(send).not.toHaveBeenCalled()
    binding.tap(45, 65)
    expect(send.mock.calls.map(c => c[0].action)).toEqual(['down', 'up'])
    binding.dispose()
  })
  it('preserves legacy selection and sends no mouse events when unsupported or read-only', () => {
    const { binding, dispatch, send } = setup(false)
    expect(dispatch('pointerdown').defaultPrevented).toBe(false)
    binding.tap(45, 65)
    expect(send).not.toHaveBeenCalled()
    binding.dispose()
  })
})
