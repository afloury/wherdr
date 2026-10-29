import { gestureAxis, gestureCommits, gestureTarget, wheelGesture } from '~/utils/tabGesture'

// The outgoing list is an inert snapshot; the incoming list remains live.
export function useHomeSwipe(root: Ref<HTMLElement | null>, ids: () => string[], current: () => string | null, preview: (id: string) => void, commit: (id: string) => void) {
  let cleanup = () => {}
  let disposed = false
  onMounted(() => {
    const el = root.value!
    const wheel = wheelGesture()
    let start: { x: number, y: number, at: number, lastX: number, lastAt: number, velocity: number } | null = null
    let old = '', next = '', dx = 0, width = 1, direction = 0
    let snapshot: HTMLElement | null = null, list: HTMLElement | null = null
    let indicator: HTMLElement | null = null
    let fromBox: DOMRect | null = null, toBox: DOMRect | null = null
    let busy = false, axis: string | null = null, swallowed = -Infinity
    let animation: Animation | null = null, incoming: Animation | null = null
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
    const reset = () => {
      snapshot?.remove(); snapshot = null
      indicator?.remove(); indicator = null; el.classList.remove('home-swiping')
      if (list) { list.style.transform = ''; list.style.willChange = '' }
      list = null; busy = false; start = null
    }
    function draw(offset: number) {
      if (reduced()) return
      if (indicator && fromBox && toBox) {
        const progress = Math.min(1, Math.abs(offset) / width)
        indicator.style.left = `${fromBox.left - el.getBoundingClientRect().left + (toBox.left - fromBox.left) * progress}px`
        indicator.style.width = `${fromBox.width + (toBox.width - fromBox.width) * progress}px`
      }
      if (snapshot) snapshot.style.transform = `translateX(${offset}px)`
      if (list) list.style.transform = `translateX(${offset - direction * width}px)`
    }
    async function begin(offset: number) {
      old = current() ?? ''
      const items = ids(), index = items.indexOf(old)
      const target = gestureTarget(index, items.length, offset)
      if (index < 0 || target === index) return false
      next = items[target]!
      direction = Math.sign(offset)
      list = el.querySelector<HTMLElement>(':scope > .scroll')
      if (!list) return false
      width = list.clientWidth
      if (!reduced()) {
        const buttons = Array.from(el.querySelectorAll<HTMLElement>('.machine-bar-item'))
        fromBox = buttons[index]!.getBoundingClientRect(); toBox = buttons[target]!.getBoundingClientRect()
        indicator = document.createElement('i')
        indicator.className = 'home-swipe-indicator'
        indicator.style.top = `${fromBox.bottom - el.getBoundingClientRect().top - 2}px`
        el.append(indicator); el.classList.add('home-swiping')
        snapshot = list.cloneNode(true) as HTMLElement
        snapshot.removeAttribute('id')
        snapshot.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'))
        snapshot.inert = true
        snapshot.setAttribute('aria-hidden', 'true')
        Object.assign(snapshot.style, { position: 'absolute', top: `${list.offsetTop}px`, left: `${list.offsetLeft}px`, width: `${width}px`, height: `${list.clientHeight}px`, zIndex: '3', pointerEvents: 'none', background: 'var(--bg)', willChange: 'transform' })
        el.append(snapshot)
        snapshot.scrollTop = list.scrollTop
        list.style.willChange = 'transform'
      }
      busy = true
      preview(next)
      await nextTick()
      draw(offset)
      return true
    }
    async function finish(accept: boolean) {
      if (!busy) return
      swallowed = performance.now()
      const end = accept ? direction * width : 0
      if (!reduced() && list && snapshot) {
        const options = { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' as const }
        if (indicator) indicator.style.transition = 'left 200ms ease, width 200ms ease'
        draw(end)
        animation = snapshot.animate([{ transform: `translateX(${dx}px)` }, { transform: `translateX(${end}px)` }], options)
        incoming = list.animate([{ transform: `translateX(${dx - direction * width}px)` }, { transform: `translateX(${end - direction * width}px)` }], options)
        await animation.finished.catch(() => {})
      }
      if (disposed) return
      if (accept) commit(next)
      else preview(old)
      animation?.cancel(); incoming?.cancel()
      reset()
    }
    function down(e: TouchEvent) {
      if (busy || e.touches.length !== 1) { start = null; return }
      const t = e.touches[0]!
      if (t.clientX < 24 || t.clientX > innerWidth - 24) return
      let node = e.target as HTMLElement | null
      if (node?.closest('input, textarea, select, [contenteditable], .machine-bar, [role="slider"]')) return
      while (node && node !== el) {
        if (node.scrollWidth > node.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return
        node = node.parentElement
      }
      const at = performance.now()
      start = { x: t.clientX, y: t.clientY, at, lastX: t.clientX, lastAt: at, velocity: 0 }
      axis = null; dx = 0
    }
    function move(e: TouchEvent) {
      if (!start) return
      if (e.touches.length !== 1) { start = null; void finish(false); return }
      const t = e.touches[0]!, now = performance.now()
      dx = t.clientX - start.x
      if (!axis) {
        // A held card belongs to its long-press handler.
        if (now - start.at > 400 || gestureAxis(dx, t.clientY - start.y) === 'y') { start = null; return }
        axis = gestureAxis(dx, t.clientY - start.y)
        if (axis === 'x') void begin(dx)
      }
      if (axis !== 'x') return
      e.preventDefault()
      start.velocity = (t.clientX - start.lastX) / Math.max(1, now - start.lastAt)
      start.lastX = t.clientX; start.lastAt = now
      if (busy) dx = direction * Math.max(0, Math.min(width, dx * direction))
      draw(dx)
    }
    function up() {
      const accept = !!start && performance.now() - start.lastAt < 100 && gestureCommits(dx, start.velocity, width)
        || !!start && gestureCommits(dx, 0, width)
      start = null
      void finish(accept)
    }
    function cancel() { start = null; void finish(false) }
    function click(e: Event) { if (busy || performance.now() - swallowed < 500) { e.preventDefault(); e.stopImmediatePropagation() } }
    function onWheel(e: WheelEvent) {
      if (!(e.target as HTMLElement)?.closest('.machine-bar') || e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.4) return
      e.preventDefault()
      const offset = wheel(e.deltaX * (e.deltaMode === 1 ? 16 : 1), e.deltaY, performance.now())
      if (!offset || busy) return
      dx = 0
      void begin(offset).then(ok => { if (ok) void finish(true) })
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', up)
    el.addEventListener('touchcancel', cancel)
    el.addEventListener('click', click, true)
    el.addEventListener('wheel', onWheel, { passive: false })
    cleanup = () => {
      el.removeEventListener('touchstart', down); el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', up); el.removeEventListener('touchcancel', cancel)
      el.removeEventListener('click', click, true); el.removeEventListener('wheel', onWheel)
      animation?.cancel(); incoming?.cancel(); reset()
    }
  })
  onBeforeUnmount(() => { disposed = true; cleanup() })
}
