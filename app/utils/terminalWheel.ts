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
