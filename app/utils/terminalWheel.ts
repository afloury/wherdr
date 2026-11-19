// Wheel and drag in the terminal -> terminal.scroll lines for Herdr.
// xterm.js only sees the frames redrawn by Herdr (never the application's
// mouse modes): left to itself, it converts the wheel into ↑/↓ ("alternate
// scroll") and Claude Code browses its message history. Herdr, for its part,
// knows the real mode: it scrolls the pane's history, or passes the
// wheel on as mouse events if the application tracks the mouse.

// WheelEvent.deltaMode : 0 = pixels, 1 = lignes (Firefox), 2 = pages.
export function wheelPixels(deltaY: number, deltaMode: number, rowHeight: number, pageRows: number): number {
  if (deltaMode === 1) return deltaY * rowHeight
  if (deltaMode === 2) return deltaY * rowHeight * Math.max(1, pageRows)
  return deltaY
}

// Accumulated movement in pixels (positive = towards the top of the history) ->
// whole lines to scroll and remainder kept for the next event.
export function takeLines(acc: number, rowHeight: number): { lines: number, rest: number } {
  const h = rowHeight > 0 ? rowHeight : 16
  const lines = Math.trunc(acc / h)
  return { lines, rest: acc - lines * h }
}

import type { Terminal } from '@xterm/xterm'

// herdr-core: a program that tracks the mouse (Claude Code's fullscreen
// renderer, vim, less --mouse) draws in the alternate screen, which has no
// scrollback for xterm to scroll: like a real terminal, the wheel goes to the
// program as mouse wheel reports, one per line (positive = towards the top).
// `sgr`: the program asked for SGR coordinates (DECSET 1006); otherwise the
// X10 encoding, whose coordinates stop at 223.
export function wheelReports(lines: number, cell: { column: number, row: number }, sgr: boolean, max = 200): string {
  const n = Math.min(Math.abs(Math.trunc(lines)), max)
  if (!n) return ''
  const button = lines > 0 ? 64 : 65
  const x = cell.column + 1, y = cell.row + 1
  const one = sgr
    ? `\x1b[<${button};${x};${y}M`
    : `\x1b[M${String.fromCharCode(32 + button, 32 + Math.min(x, 223), 32 + Math.min(y, 223))}`
  return one.repeat(n)
}

export interface SgrMouse { on: () => boolean, reset: () => void }

// xterm tracks the mouse modes but does not expose the encoding: follow
// DECSET/DECRST 1006 in stream order. xterm drops the encoding on RIS (ESC c)
// and on term.reset(): the caller calls reset() right after its own resets.
export function trackSgrMouse(term: Pick<Terminal, 'parser'>): SgrMouse {
  let sgr = false
  const mode = (on: boolean) => (params: (number | number[])[]) => {
    if (params.includes(1006)) sgr = on
    return false
  }
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, mode(true))
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, mode(false))
  term.parser.registerEscHandler({ final: 'c' }, () => { sgr = false; return false })
  return { on: () => sgr, reset: () => { sgr = false } }
}
