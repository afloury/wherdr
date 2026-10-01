// Context menu of headers (right click on a computer, long press with a
// finger): where it must not open. Pure (tested).
type El = { closest?: (sel: string) => unknown } | null | undefined

// Areas that keep the browser's native menu (input field, terminal,
// conversation text) even if they are inside a header.
export const NATIVE_MENU = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm, .term, .chat-list, .msg'
// Long press: ignored on buttons, links, tabs and the move
// handle (they have their own gesture).
export const PRESS_SKIP = `button, a, [role="tab"], [role="button"]:not(.plan-cell), .cell-grip, ${NATIVE_MENU}`

export function keepsNativeMenu(target: El): boolean {
  return !!target?.closest?.(NATIVE_MENU)
}
export function skipsPress(target: El): boolean {
  return !!target?.closest?.(PRESS_SKIP)
}
