// Swipe down to close a bottom sheet (phone). Pure decisions, kept apart from
// the DOM so they can be tested: where a drag may start, how far the sheet
// follows the finger, and whether a release closes it.

/** Distance (px) a finger must travel down before the gesture becomes a drag. */
export const SHEET_DRAG_SLOP = 8
/** Release closes past this share of the sheet's height… */
export const SHEET_CLOSE_RATIO = 0.25
/** …or past this many pixels, whichever is smaller… */
export const SHEET_CLOSE_DISTANCE = 120
/** …or on a flick faster than this (px/ms) once past the slop. */
export const SHEET_CLOSE_VELOCITY = 0.5

/** Sheet offset for a finger travel: follows down, resists going up. */
export function sheetDragOffset(dy: number): number {
  return dy > 0 ? dy : -Math.sqrt(-dy) * 2
}

/** Whether releasing after `dy` px at `velocity` px/ms (down = positive) closes the sheet. */
export function sheetDragCloses(dy: number, velocity: number, height: number): boolean {
  if (dy <= SHEET_DRAG_SLOP) return false
  if (velocity >= SHEET_CLOSE_VELOCITY) return true
  return dy >= Math.min(SHEET_CLOSE_DISTANCE, height * SHEET_CLOSE_RATIO)
}
