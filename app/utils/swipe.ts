// Horizontal swipe between the panes of a tab (phone), pure.

// Axis of the gesture, decided once the finger has moved a few pixels: horizontal
// only if it clearly dominates (otherwise it is a conversation scroll).
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | null {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < 10) return null
  return ax > ay * 1.3 ? 'x' : 'y'
}

// End of the gesture: +1 = next pane (finger to the left), -1 = previous, 0 = nothing.
// Far enough (a quarter of the screen), or a quick flick.
export function swipeStep(dx: number, ms: number, width: number): 1 | -1 | 0 {
  const ax = Math.abs(dx)
  const far = ax >= Math.max(60, width * 0.25)
  const flick = ax >= 36 && ax / Math.max(ms, 1) > 0.45
  if (!far && !flick) return 0
  return dx < 0 ? 1 : -1
}

// Offset shown during the gesture: damped, and braked at the edge (no neighbour).
export function swipeOffset(dx: number, canGo: boolean): number {
  return Math.round(canGo ? dx * 0.55 : dx * 0.18)
}
