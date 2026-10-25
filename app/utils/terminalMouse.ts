import type { Terminal } from '@xterm/xterm'
import type { TerminalMouse } from '../../shared/herdrFeatures'

export function terminalCell(x: number, y: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, cols: number, rows: number) {
  if (rect.width <= 0 || rect.height <= 0 || cols <= 0 || rows <= 0) return null
  return {
    column: Math.max(0, Math.min(cols - 1, Math.floor((x - rect.left) * cols / rect.width))),
    row: Math.max(0, Math.min(rows - 1, Math.floor((y - rect.top) * rows / rect.height))),
  }
}

export function bindTerminalMouse(term: Terminal, enabled: () => boolean, send: (event: TerminalMouse) => void) {
  const root = term.element!
  let pressed: TerminalMouse['button'] | null = null
  let pointer: number | null = null
  let pending: TerminalMouse | null = null
  let raf = 0
  const cell = (x: number, y: number) => {
    const rect = root.querySelector('.xterm-screen')?.getBoundingClientRect()
    return rect ? terminalCell(x, y, rect, term.cols, term.rows) : null
  }
  const event = (e: PointerEvent, action: TerminalMouse['action'], button: TerminalMouse['button']): TerminalMouse | null => {
    const pos = cell(e.clientX, e.clientY)
    // crossterm KeyModifiers: Shift=1, Control=2, Alt=4, Super=8.
    return pos && { type: 'terminal.mouse', action, button, ...pos, modifiers: (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0) }
  }
  const flush = () => {
    cancelAnimationFrame(raf)
    raf = 0
    if (pending && enabled()) send(pending)
    pending = null
  }
  const down = (e: PointerEvent) => {
    // Links keep their browser modifier. Shift+drag stays xterm selection.
    if (!enabled() || e.pointerType === 'touch' || e.shiftKey || e.ctrlKey || e.metaKey || e.button > 2) return
    const button = (['left', 'middle', 'right'] as const)[e.button]!
    const m = event(e, 'down', button)
    if (!m) return
    e.preventDefault()
    e.stopPropagation()
    pressed = button
    pointer = e.pointerId
    term.clearSelection()
    term.focus()
    send(m)
  }
  const move = (e: PointerEvent) => {
    if (!enabled() || e.pointerType === 'touch' || e.shiftKey || e.ctrlKey || e.metaKey) return
    if (pressed ? e.pointerId !== pointer : !root.contains(e.target as Node)) return
    pending = event(e, pressed ? 'drag' : 'move', pressed || 'left')
    if (!raf) raf = requestAnimationFrame(flush)
  }
  const up = (e: PointerEvent) => {
    if (!pressed || e.pointerId !== pointer) return
    flush()
    const m = event(e, 'up', pressed)
    pressed = null
    pointer = null
    if (m && enabled()) send(m)
  }
  const context = (e: MouseEvent) => {
    if (enabled() && !e.shiftKey && !e.ctrlKey && !e.metaKey) e.preventDefault()
  }
  root.addEventListener('contextmenu', context)
  root.addEventListener('pointerdown', down, true)
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  return {
    tap(x: number, y: number) {
      const pos = enabled() && cell(x, y)
      if (!pos) return
      for (const action of ['down', 'up'] as const) send({ type: 'terminal.mouse', action, button: 'left', ...pos, modifiers: 0 })
    },
    dispose() {
      cancelAnimationFrame(raf)
      root.removeEventListener('contextmenu', context)
      root.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    },
  }
}
