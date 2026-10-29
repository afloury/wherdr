import { gestureAxis, gestureCommits, gestureOffset, gestureTarget, wheelGesture } from '~/utils/tabGesture'

// Touch previews the current panel; Vue completes the release transition.
export function useHomeSwipe(root: Ref<HTMLElement | null>, ids: () => string[], current: () => string | null, commit: (id: string) => void) {
  const direction = ref(-1)
  watch(current, (next, previous) => {
    direction.value = ids().indexOf(next ?? '') > ids().indexOf(previous ?? '') ? -1 : 1
  })
  let cleanup = () => {}
  onMounted(() => {
    const el = root.value!
    const wheel = wheelGesture()
    const viewport = el.querySelector<HTMLElement>('.home-content')!
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const width = () => viewport.clientWidth
    function indicate(offset = 0) {
      const bar = el.querySelector<HTMLElement>('.machine-bar'), indicator = el.querySelector<HTMLElement>('.machine-bar-indicator')
      if (!bar || !indicator) return
      const buttons = Array.from(bar.querySelectorAll<HTMLElement>('.machine-bar-item'))
      const index = ids().indexOf(current() ?? ''), from = buttons[index]
      const to = buttons[gestureTarget(index, buttons.length, offset)]
      if (!from || !to) return
      const progress = Math.min(1, Math.abs(offset) / width())
      indicator.style.transform = `translateX(${from.offsetLeft + (to.offsetLeft - from.offsetLeft) * progress}px)`
      indicator.style.width = `${from.offsetWidth + (to.offsetWidth - from.offsetWidth) * progress}px`
    }
    const stopIndicator = watch(() => [current(), ...ids()], () => indicate(), { flush: 'post' })
    const resize = new ResizeObserver(() => indicate())
    resize.observe(el)
    indicate()
    function preview(offset: number) {
      viewport.classList.add('home-dragging')
      viewport.style.setProperty('--home-touch', `${offset}px`)
      indicate(offset)
    }
    function reset(animate = true) {
      viewport.classList.toggle('home-returning', animate && viewport.classList.contains('home-dragging'))
      viewport.classList.remove('home-dragging')
      indicate()
    }
    let dx = 0, swallowed = -Infinity
    let start: { x: number, y: number, at: number, lastX: number, lastAt: number, velocity: number } | null = null
    let axis: string | null = null
    function select(offset: number) {
      const items = ids(), index = items.indexOf(current() ?? '')
      const target = gestureTarget(index, items.length, offset)
      if (index >= 0 && target !== index) {
        viewport.style.setProperty('--home-release', start && !reduced.matches ? viewport.style.getPropertyValue('--home-touch') : '0px')
        commit(items[target]!)
        return true
      }
      return false
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
      if (e.touches.length !== 1) { cancel(); return }
      const t = e.touches[0]!
      if (t.clientX < 24 || t.clientX > innerWidth - 24 || excluded(e.target as HTMLElement)) return
      const at = performance.now()
      start = { x: t.clientX, y: t.clientY, at, lastX: t.clientX, lastAt: at, velocity: 0 }
      viewport.classList.remove('home-returning')
      axis = null; dx = 0
      viewport.style.setProperty('--home-release', '0px')
    }
    function move(e: TouchEvent) {
      if (!start) return
      if (e.touches.length !== 1) { cancel(); return }
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
      const index = ids().indexOf(current() ?? '')
      if (!reduced.matches) preview(gestureOffset(index, ids().length, dx, width()))
    }
    function up() {
      let changed = false
      if (start && axis === 'x') {
        swallowed = performance.now()
        if (gestureCommits(dx, performance.now() - start.lastAt < 100 ? start.velocity : 0, width())) changed = select(dx)
      }
      start = null
      reset(!changed)
    }
    function cancel() { start = null; reset() }
    function click(e: Event) {
      if (performance.now() - swallowed < 500) { e.preventDefault(); e.stopImmediatePropagation(); return }
      viewport.style.setProperty('--home-release', '0px')
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
      stopIndicator(); resize.disconnect()
      el.removeEventListener('touchstart', down); el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', up); el.removeEventListener('touchcancel', cancel)
      el.removeEventListener('click', click, true); window.removeEventListener('wheel', onWheel, true)
    }
  })
  onBeforeUnmount(() => cleanup())
  return direction
}
