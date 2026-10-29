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
// A quiet period ends a trackpad gesture, including its inertial tail.
export function wheelGesture() {
  let last = -Infinity, sum = 0, used = false
  return (dx: number, dy: number, now: number) => {
    if (now - last > 220) { sum = 0; used = false }
    last = now
    if (used || Math.abs(dx) <= Math.abs(dy) * 1.4) return 0
    sum += dx
    if (Math.abs(sum) < 56) return 0
    used = true
    return sum > 0 ? -1 : 1
  }
}
