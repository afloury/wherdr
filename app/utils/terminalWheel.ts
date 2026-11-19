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

// Claude Code's fullscreen view accelerates wheel reports that arrive less
// than 40 ms apart (each one moves 0.3 row more, up to 6 rows) and moves one
// row again after a 40 ms pause; the first report after a reversal moves
// nothing. One report per pixel row, sent in a burst,
// made a fast trackpad scroll fly 6 to 20 times further than the fingers.
const ACCEL_GAP = 40, ACCEL_STEP = 0.3, ACCEL_MAX = 6

// Reports to send for `lines` rows given the program's current multiplier
// (0: rested, the next report moves one row). Never more rows than asked,
// except the first report when the multiplier is already above `lines`.
export function wheelPlan(lines: number, mult: number): { reports: number, rows: number, mult: number } {
  let reports = 0, rows = 0, m = mult
  while (rows < lines) {
    const next = m ? Math.min(ACCEL_MAX, m + ACCEL_STEP) : 1
    if (reports && rows + Math.floor(next) > lines) break
    m = next
    rows += Math.floor(m)
    reports++
  }
  return { reports, rows, mult: m }
}

export interface WheelPacer { push: (lines: number) => void, frame: () => void, cancel: () => void }

// Paces wheel reports to a program tracking the mouse: rows add up while a
// burst waits for its repaint (one burst in flight, never a queue behind a
// busy program), at most a page is kept (a program that stalls does not jump
// on), and the rows are turned into reports through the program's
// acceleration, so it moves as far as the gesture.
export function createWheelPacer(o: {
  send: (reports: number) => boolean
  page: () => number
  now?: () => number
  // A burst that gets no repaint (an edge, nothing to redraw) stops blocking after this.
  wait?: number
}): WheelPacer {
  const now = o.now ?? (() => performance.now())
  const wait = o.wait ?? 200
  let pending = 0, mult = 0, sentAt = -Infinity, inFlight = false, dir = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const later = (ms: number) => { clearTimeout(timer); timer = setTimeout(flush, Math.max(0, ms)) }
  function flush() {
    timer = undefined
    if (!pending) return
    const t = now()
    if (inFlight && t - sentAt < wait) return later(sentAt + wait - t)
    const sign = Math.sign(pending)
    const flip = dir !== 0 && sign !== dir
    const rested = flip || t - sentAt > ACCEL_GAP
    const plan = wheelPlan(Math.abs(pending), rested ? 0 : mult)
    // Less than one accelerated report left: sent one row at a time after the pause.
    if (!rested && plan.rows > Math.abs(pending)) return later(sentAt + ACCEL_GAP + 1 - t)
    if (!o.send(sign * (plan.reports + (flip ? 1 : 0)))) { pending = 0; return }
    pending -= sign * plan.rows
    mult = plan.mult
    sentAt = t
    dir = sign
    inFlight = true
    if (pending) later(wait)
  }
  return {
    push(lines) {
      if (!lines) return
      // A reversal drops what the other direction still had to do.
      if (pending && Math.sign(lines) !== Math.sign(pending)) pending = 0
      const max = Math.max(1, o.page())
      pending = Math.max(-max, Math.min(max, pending + lines))
      flush()
    },
    frame() {
      if (!inFlight) return
      inFlight = false
      flush()
    },
    cancel() { clearTimeout(timer); timer = undefined; pending = 0; inFlight = false; mult = 0; dir = 0 },
  }
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
