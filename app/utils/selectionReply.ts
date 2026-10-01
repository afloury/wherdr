// Floating "Reply" button near a passage selected in an agent
// message. Anchored on the logical end of the selection (last character,
// last line), even if it was made upwards: the button "closes"
// the passage like an end cursor, and anchoring at the release point
// at the top left would land on the preceding text.
// Computer: just right of the last character, centered on its line; if it
// overflows on the right, below the end of the last line, right-aligned on the
// last word. Phone: always below the last line, low enough to
// leave room for the end handle (iOS's native menu is above).
// It only appears once the selection is stable (see createSelectionSettler).
export interface Rect { top: number, bottom: number, left: number, right: number }
export interface Box { width: number, height: number }
export interface View { width: number, top: number, bottom: number }

export const SEL_GAP = 6
export const SEL_MARGIN = 8
// Below the iOS / Android end handle (a ball about 12 px under the line).
export const SEL_TOUCH_GAP = 22

// Rectangle of the last line: the last non-empty rectangle of
// range.getClientRects() (empty rectangles come from block ends).
export function lastLineRect(rects: ArrayLike<Rect>): Rect | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]!
    if (r.right - r.left > 0.5 && r.bottom - r.top > 0.5) return r
  }
  return null
}

export function selectionReplyPos(end: Rect, btn: Box, view: View, touch: boolean): { top: number, left: number } | null {
  // End of selection out of the visible area (scrolling): no button.
  if (end.bottom < view.top || end.top > view.bottom) return null
  const maxLeft = view.width - btn.width - SEL_MARGIN
  const underLeft = Math.min(Math.max(SEL_MARGIN, end.right - btn.width), maxLeft)
  const gapBelow = touch ? SEL_TOUCH_GAP : SEL_GAP
  const below = end.bottom + gapBelow
  if (!touch && end.right + SEL_GAP <= maxLeft) {
    // On the line, after the last character: never covers the selection.
    const top = Math.round(end.top + (end.bottom - end.top - btn.height) / 2)
    return { top: Math.min(Math.max(top, view.top), view.bottom - btn.height), left: end.right + SEL_GAP }
  }
  if (below + btn.height <= view.bottom) return { top: below, left: underLeft }
  // No room below: above the last line (computer only,
  // the phone's native menu takes the top).
  const above = end.top - SEL_GAP - btn.height
  if (!touch && above >= view.top) return { top: above, left: underLeft }
  return { top: Math.max(view.top, view.bottom - btn.height - SEL_MARGIN), left: underLeft }
}

// Delays before appearing: after release, after a keyboard change
// (Shift+arrows) without release, and on the phone (handle adjustment).
export const SETTLE_POINTER = 180
export const SETTLE_KEYBOARD = 350
export const SETTLE_TOUCH = 380
export const SETTLE_SCROLL = 160

// Decides when to show the button: never while dragging, only after
// a stability delay; any change hides it right away.
export function createSelectionSettler(o: { show: () => void, hide: () => void, touch: () => boolean }) {
  let pressed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (timer) clearTimeout(timer); timer = null }
  const later = (ms: number) => { clear(); timer = setTimeout(() => { timer = null; if (!pressed) o.show() }, ms) }
  return {
    down() { pressed = true; clear(); o.hide() },
    up() { if (!pressed) return; pressed = false; later(o.touch() ? SETTLE_TOUCH : SETTLE_POINTER) },
    // Selection changed. `same`: nothing moved (spurious event), we keep the button.
    change(same = false) {
      if (same) return
      o.hide()
      if (pressed) { clear(); return }
      later(o.touch() ? SETTLE_TOUCH : SETTLE_KEYBOARD)
    },
    scroll() { o.hide(); if (!pressed) later(SETTLE_SCROLL) },
    dispose() { clear() },
  }
}

// Length of a piece of text without its trailing whitespace (spaces, newlines).
// Returns the piece (index) and the offset just after its last non-blank
// character, starting from the end; null if everything is blank.
export function trimmedEnd(parts: readonly string[]): { index: number, offset: number } | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const offset = parts[i]!.replace(/\s+$/u, '').length
    if (offset > 0) return { index: i, offset }
  }
  return null
}

// Range trimmed to a message's content: a triple click or a drag to the
// end often overflows ("Reply" footer, next message, list) and ends with
// a newline. We keep the start, cut the end at the content, then at the
// last non-blank characters. Null if nothing visible remains.
export function clampRange(range: Range, content: Node): Range | null {
  const r = range.cloneRange()
  if (!content.contains(r.startContainer)) {
    // Start before the content (in the message header): we start from the content.
    if (r.comparePoint(content, 0) < 0) return null
    r.setStart(content, 0)
  }
  if (!content.contains(r.endContainer)) r.setEnd(content, content.childNodes.length)
  const nodes: Text[] = []
  const parts: string[] = []
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!r.intersectsNode(n)) continue
    const from = n === r.startContainer ? r.startOffset : 0
    const to = n === r.endContainer ? r.endOffset : n.data.length
    nodes.push(n)
    parts.push(n.data.slice(from, to))
  }
  const end = trimmedEnd(parts)
  if (!end) return null
  const node = nodes[end.index]!
  r.setEnd(node, (node === r.startContainer ? r.startOffset : 0) + end.offset)
  return r
}
