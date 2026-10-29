// Positive offsets move to the previous tab. No wrapping at either end.
export function gestureTarget(index: number, count: number, dx: number) {
  const target = index + (dx < 0 ? 1 : -1)
  return target >= 0 && target < count ? target : index
}
export function gestureCommits(dx: number, velocity: number, width: number) {
  return Math.abs(dx) >= Math.min(100, width * .25)
    || (Math.abs(dx) >= 24 && Math.abs(velocity) >= .5 && Math.sign(dx) === Math.sign(velocity))
}
export function gestureAxis(dx: number, dy: number) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return null
  return Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y'
}
// WheelEvent has no portable finger-up phase. Keep the whole inertial tail,
// ending on silence or a renewed impulse after decay, never on pointer movement.
export const WHEEL_IDLE = 160
export function wheelGesture() {
  let at = -Infinity, x = 0, y = 0, previous = 0, tail = 0, momentum = false
  let axis: 'x' | 'y' | null = null
  return (dx: number, dy: number, now: number, inertial?: boolean) => {
    const fresh = now - at >= WHEEL_IDLE || (momentum && inertial === false)
      || (axis === 'x' && tail >= 3 && Math.abs(dx) >= 12 && dx * previous >= 0 && Math.abs(dx) > Math.abs(previous) * 3)
    if (fresh) { x = 0; y = 0; axis = null; tail = 0 }
    const velocity = -dx / (fresh ? 16 : Math.max(8, now - at))
    tail = Math.abs(dx) <= 4 && Math.abs(dx) <= Math.abs(previous) ? tail + 1 : 0
    at = now; previous = dx; momentum = inertial === true
    x -= dx; y += dy
    if (!axis && Math.max(Math.abs(x), Math.abs(y)) >= 18) axis = Math.abs(x) > Math.abs(y) * 2.2 ? 'x' : 'y'
    return { fresh, axis, offset: x, velocity }
  }
}
