import { gestureAxis, gestureCommits, gestureTarget, wheelGesture } from '~/utils/tabGesture'

// Recognize input only. Vue's keyed Transition owns the content animation.
export function useHomeSwipe(root: Ref<HTMLElement | null>, ids: () => string[], current: () => string | null, commit: (id: string) => void) {
  const direction = ref(-1)
  watch(current, (next, previous) => {
    direction.value = ids().indexOf(next ?? '') > ids().indexOf(previous ?? '') ? -1 : 1
  })
  let cleanup = () => {}
  onMounted(() => {
    const el = root.value!
    const wheel = wheelGesture()
    let dx = 0, swallowed = -Infinity
    let start: { x: number, y: number, at: number, lastX: number, lastAt: number, velocity: number } | null = null
    let axis: string | null = null
    const width = () => el.clientWidth
    function select(offset: number) {
      const items = ids(), index = items.indexOf(current() ?? '')
      const target = gestureTarget(index, items.length, offset)
      if (index >= 0 && target !== index) commit(items[target]!)
    }
    function excluded(node: HTMLElement | null, wheel = false) {
      if (node?.closest('input, textarea, select, [contenteditable], [role="slider"]') || (!wheel && node?.closest('.machine-bar'))) return true
      while (node && node !== document.body) {
        if (!(wheel && node.classList.contains('machine-bar')) && node.scrollWidth > node.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return true
        node = node.parentElement
      }
      return false
    }
    function down(e: TouchEvent) {
      if (e.touches.length !== 1) { start = null; return }
      const t = e.touches[0]!
      if (t.clientX < 24 || t.clientX > innerWidth - 24 || excluded(e.target as HTMLElement)) return
      const at = performance.now()
      start = { x: t.clientX, y: t.clientY, at, lastX: t.clientX, lastAt: at, velocity: 0 }
      axis = null; dx = 0
    }
    function move(e: TouchEvent) {
      if (!start) return
      if (e.touches.length !== 1) { start = null; return }
      const t = e.touches[0]!, now = performance.now()
      dx = t.clientX - start.x
      if (!axis) {
        // A held card belongs to its long-press handler.
        if (now - start.at > 400 || gestureAxis(dx, t.clientY - start.y) === 'y') { start = null; return }
        axis = gestureAxis(dx, t.clientY - start.y)
      }
      if (axis !== 'x') return
      e.preventDefault()
      start.velocity = (t.clientX - start.lastX) / Math.max(1, now - start.lastAt)
      start.lastX = t.clientX; start.lastAt = now
    }
    function up() {
      if (start && axis === 'x') {
        swallowed = performance.now()
        if (gestureCommits(dx, performance.now() - start.lastAt < 100 ? start.velocity : 0, width())) select(dx)
      }
      start = null
    }
    function cancel() { start = null }
    function click(e: Event) {
      if (performance.now() - swallowed < 500) { e.preventDefault(); e.stopImmediatePropagation(); return }
      wheel.cancel()
    }
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || start) return
      // Wheel transactions can retain a stale target after the list changes.
      const hit = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      if (!hit?.closest('#home, #placeholder') || excluded(hit, true)) return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerWidth : 1
      // Source timestamps keep a render stall from splitting the input stream.
      const state = wheel(e.deltaX * unit, e.deltaY * unit, e.timeStamp, (e as WheelEvent & { momentum?: boolean }).momentum, width())
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2.2) return
      // Claim horizontal input from its first cancellable packet, before axis lock.
      if (state.axis !== 'x') {
        if (!state.axis && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 2.2) e.preventDefault()
        return
      }
      e.preventDefault()
      if (state.step) select(state.step)
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', up)
    el.addEventListener('touchcancel', cancel)
    el.addEventListener('click', click, true)
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    cleanup = () => {
      el.removeEventListener('touchstart', down); el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', up); el.removeEventListener('touchcancel', cancel)
      el.removeEventListener('click', click, true); window.removeEventListener('wheel', onWheel, true)
    }
  })
  onBeforeUnmount(() => cleanup())
  return direction
}
