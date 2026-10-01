// Long press with a finger (phone): `onPress` after `delay` ms if the finger has
// not moved more than `slop` px (otherwise it is a scroll) nor left the screen.
// The tap that triggered it does not count as a simple tap:
// `swallowClick()` tells the click handler. Pure (tested).
export interface LongPressOptions { delay?: number, slop?: number, onPress: () => void }
type Point = { pointerType: string, clientX: number, clientY: number }

export function longPress({ delay = 450, slop = 8, onPress }: LongPressOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let x = 0
  let y = 0
  let firedAt = 0
  // iOS sometimes triggers "select all" on a long press, even on a
  // non-selectable element: we block any selection during the press.
  const noSelect = (ev: Event) => ev.preventDefault()
  const doc = typeof document === 'undefined' ? null : document
  const release = () => {
    doc?.removeEventListener('selectstart', noSelect)
    setTimeout(() => doc?.removeEventListener('selectstart', noSelect), 0)
  }
  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    release()
  }
  return {
    down(e: Point) {
      cancel()
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
      x = e.clientX
      y = e.clientY
      doc?.addEventListener('selectstart', noSelect)
      timer = setTimeout(() => {
        timer = null
        firedAt = Date.now()
        doc?.getSelection?.()?.removeAllRanges()
        onPress()
        setTimeout(release, 800)
      }, delay)
    },
    move(e: Point) {
      if (timer && Math.hypot(e.clientX - x, e.clientY - y) > slop) cancel()
    },
    cancel,
    // A drag may last well over 800 ms after the long press.
    // Restart from the release to ignore iOS's synthetic click.
    suppressClick: () => { firedAt = Date.now() },
    // The click following the long press (finger lifted): to ignore.
    swallowClick: () => Date.now() - firedAt < 800,
  }
}
