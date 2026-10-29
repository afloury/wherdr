// Positive offsets move to the previous tab. No wrapping at either end.
export function gestureTarget(index: number, count: number, dx: number) {
  const target = index + (dx < 0 ? 1 : -1)
  return target >= 0 && target < count ? target : index
}
// Preview is bounded to one page, with resistance when there is no neighbor.
export function gestureOffset(index: number, count: number, dx: number, width: number) {
  const offset = gestureTarget(index, count, dx) === index ? dx * .15 : dx
  return Math.sign(offset) * Math.min(Math.abs(offset), width)
}
export function gestureCommits(dx: number, velocity: number, width: number) {
  return Math.abs(dx) >= Math.min(100, width * .25)
    || (Math.abs(dx) >= 24 && Math.abs(velocity) >= .5 && Math.sign(dx) === Math.sign(velocity))
}
export function gestureAxis(dx: number, dy: number) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return null
  return Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y'
}
// Emit once at the threshold. Silence or renewed pressure only rearm; they never delay selection.
export const WHEEL_IDLE = 160
export function wheelGesture() {
  let at = -Infinity, x = 0, y = 0, previous = 0, tail = 0, momentum = false, used = false
  let axis: 'x' | 'y' | null = null
  const feed = (dx: number, dy: number, now: number, inertial?: boolean, width = 340) => {
    const fresh = inertial !== true && (now - at >= WHEEL_IDLE || (momentum && inertial === false)
      || (axis === 'x' && tail >= 3 && Math.abs(dx) >= 12 && (used || dx * previous >= 0) && Math.abs(dx) > Math.abs(previous) * 3))
    if (fresh) { x = 0; y = 0; axis = null; tail = 0; used = false }
    const velocity = -dx / (fresh ? 16 : Math.max(8, now - at))
    tail = Math.abs(dx) <= 4 && Math.abs(dx) <= Math.abs(previous) ? tail + 1 : 0
    at = now; previous = dx; momentum = inertial === true
    x -= dx; y += dy
    if (!axis && Math.max(Math.abs(x), Math.abs(y)) >= 18) axis = Math.abs(x) > Math.abs(y) * 2.2 ? 'x' : 'y'
    const step = !used && axis === 'x' && Math.abs(dx) > Math.abs(dy) * 2.2
      && Math.abs(x) >= 56 && gestureCommits(x, velocity, width) ? x : 0
    if (step) used = true // Also consume attempts at the first/last tab.
    return { fresh, axis, offset: x, velocity, step }
  }
  return Object.assign(feed, { cancel: () => { used = true } })
}
