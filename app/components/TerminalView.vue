<script setup lang="ts">
// Raw terminal of the pane: xterm.js + touch layer (scrolling with a finger or
// the wheel -> terminal.scroll, the history lives in Herdr; never ↑/↓
// sent to the agent; click = keyboard to the terminal).
import '@xterm/xterm/css/xterm.css'
import { createTerminalTouch, rubberOffset, takeTouchLines } from '~/utils/terminalTouch'

const props = defineProps<{ ctl: TerminalCtl }>()
const host = ref<HTMLElement | null>(null)

let acc = 0
let pendingLines = 0
// Signed rows sent to Herdr whose frames have not come back yet (the server
// answers scroll.ack once a frame covers them). The visual offset below
// keeps the screen glued to the finger in the meantime.
let unconfirmed = 0
let momentumDebt = 0
let pendingMomentum = 0
let momentumAcc = 0

let hadScroll = false
let settleId = 0
let settleTimer: ReturnType<typeof setTimeout> | undefined
let raf = 0
let scrollX: number | undefined
let scrollY: number | undefined
let scrollModifiers = 0
let touchSource = false
let touchPrimed = false
let lastTouchAt = -Infinity
const screenEl = () => host.value?.querySelector('.xterm-screen') as HTMLElement | null
// Slide the rendered screen by the scroll the server hasn't painted yet.
// v is the exact unpaid scroll: sub-row pixels in acc follow the finger
// instantly, row-sized debt lives in pendingLines/unconfirmed and is
// released only when the covering frame paints -- every offset change is
// either a finger move or a paint, never a synthetic animation. Momentum
// rows are sent and accounted in pendingMomentum/momentumDebt but never
// shown: after the finger lifts nothing tracks it, and translating old
// content there only reads as an afterimage against the real frames.
const applyOffset = () => {
  const el = screenEl()
  if (!el) return
  const h = props.ctl.rowHeight()
  const v = acc + (pendingLines + unconfirmed) * h
  const px = rubberOffset(v, h)
  if (px) { el.style.willChange = 'transform'; el.style.transform = `translate3d(0, ${px}px, 0)` }
  else { el.style.willChange = ''; el.style.transform = '' }
}
const flush = () => {
  raf = 0
  const n = pendingLines + pendingMomentum
  if (!n) return
  unconfirmed += pendingLines
  momentumDebt += pendingMomentum
  pendingLines = 0
  pendingMomentum = 0
  armSettle()
  props.ctl.scroll(n, scrollX, scrollY, scrollModifiers, touchSource)
}
const queue = (n: number, hidden = false) => {
  if (hidden) pendingMomentum += n
  else pendingLines += n
  hadScroll = true
  if (!raf) raf = requestAnimationFrame(flush)
}
// scroll.ack counts the rows the server has just painted. The ack arrives
// with its frame's bytes but xterm paints asynchronously: retiring the rows
// right away would slide the offset back before the content moves (the
// "scroll, snap back, scroll" jitter). Stage them in pendingAck instead and
// only take them out in the animation frame after the write callback, when
// the new content is actually on screen.
let pendingAck = 0
watch(props.ctl.scrollAck, () => {
  const d = props.ctl.scrollAck.value
  props.ctl.scrollAck.value = 0
  if (!d) return
  pendingAck += d
  armSettle()
})
// Rows the settle timer wrote off while no frames arrived: the offset was
// already glided home, so when their acks finally land they must not drop
// the offset again. Late acks pay down writtenOff first; the remainder
// releases only the displayed debt that still exists, in the animation
// frame right after the write callback -- content jump and offset release
// then cancel out within the same composite frame.
let writtenOff = 0
watch(props.ctl.frameTick, () => {
  if (!pendingAck) return
  requestAnimationFrame(() => {
    let rem = pendingAck
    pendingAck = 0
    // Pay down in send order: written-off rows first, then the displayed
    // debt, and only the overflow releases hidden momentum rows.
    const w = Math.sign(writtenOff) === Math.sign(rem)
      ? Math.sign(rem) * Math.min(Math.abs(writtenOff), Math.abs(rem)) : 0
    writtenOff -= w
    rem -= w
    const u = Math.sign(rem) === Math.sign(unconfirmed)
      ? Math.sign(rem) * Math.min(Math.abs(rem), Math.abs(unconfirmed)) : 0
    unconfirmed -= u
    rem -= u
    if (Math.sign(rem) === Math.sign(momentumDebt))
      momentumDebt -= Math.sign(rem) * Math.min(Math.abs(rem), Math.abs(momentumDebt))
    applyOffset()
  })
})
// When acks stop arriving (a scroll edge or a stalled pane), glide the
// leftover offset home instead of leaving the screen displaced.
function armSettle() {
  clearTimeout(settleTimer)
  if (Math.abs(unconfirmed) < .04 && Math.abs(momentumDebt) < .04 && Math.abs(pendingAck) < .04) return
  settleTimer = setTimeout(() => { settleTimer = undefined; settleUnconfirmed() }, 160)
}
function settleUnconfirmed() {
  if (settleId) return
  const step = () => {
    settleId = 0
    // Staged acks release debt here too (their frame is painting anyway);
    // adding them to the debt instead would leave the offset lingering.
    const u = Math.sign(pendingAck) === Math.sign(unconfirmed)
      ? Math.sign(pendingAck) * Math.min(Math.abs(pendingAck), Math.abs(unconfirmed)) : 0
    unconfirmed -= u
    const rem = pendingAck - u
    pendingAck = 0
    if (Math.sign(rem) === Math.sign(momentumDebt))
      momentumDebt -= Math.sign(rem) * Math.min(Math.abs(rem), Math.abs(momentumDebt))
    // Decayed rows move to writtenOff so their late acks don't land twice.
    const decayed = unconfirmed * .45
    const mDecayed = momentumDebt * .45
    writtenOff = writtenOff * .55 + decayed + mDecayed
    unconfirmed -= decayed
    momentumDebt -= mDecayed
    if (Math.abs(unconfirmed) < .04) unconfirmed = 0
    if (Math.abs(momentumDebt) < .04) momentumDebt = 0
    applyOffset()
    if (unconfirmed || momentumDebt) settleId = requestAnimationFrame(step)
  }
  settleId = requestAnimationFrame(step)
}
const scroller = () => host.value?.querySelector('.xterm') as HTMLElement | null
const touch = createTerminalTouch({
  vertical(pixels, point) {
    scrollX = point.x; scrollY = point.y
    acc += pixels
    const { lines, rest, primed } = takeTouchLines(acc, props.ctl.rowHeight(), touchPrimed)
    acc = rest
    touchPrimed = primed
    if (lines) queue(lines)
    applyOffset()
  },
  // Inertia sends the same rows but off-screen debt: nothing follows the
  // finger anymore, and a translated preview of stale rows reads as ghost.
  momentum(pixels, point) {
    scrollX = point.x; scrollY = point.y
    momentumAcc += pixels
    const { lines, rest, primed } = takeTouchLines(momentumAcc, props.ctl.rowHeight(), touchPrimed)
    momentumAcc = rest
    touchPrimed = primed
    if (lines) queue(lines, true)
  },
  horizontal(pixels) { const el = scroller(); if (el) el.scrollLeft -= pixels },
  canHorizontal: () => { const el = scroller(); return !!el && el.scrollWidth > el.clientWidth },
  maxMomentum: () => props.ctl.rowHeight() * props.ctl.pageRows() * 1.5,
})
function cancelTouch() {
  touch.cancel()
  cancelAnimationFrame(raf); raf = 0
  // Unsent rows and leftover sub-row pixels fold into the row debt so the
  // offset eases home through the normal release path instead of snapping.
  unconfirmed += pendingLines + acc / props.ctl.rowHeight()
  pendingLines = 0
  acc = 0
  // Momentum sends already left: keep their accounting as written-off debt,
  // drop the unsent pixels entirely (they were never displayed or sent).
  writtenOff += momentumDebt
  momentumDebt = 0
  pendingMomentum = 0
  momentumAcc = 0
  // touch.cancel is the interrupt: only worth a packet when a gesture was
  // actually scrolling (taps that merely focus the pane no longer send it).
  if (hadScroll) props.ctl.cancelTouchScroll()
  hadScroll = false
  settleUnconfirmed()
}
watch(props.ctl.scrollInputVersion, cancelTouch)
watch(pageVisible, visible => { if (!visible) cancelTouch() })
function onTouchStart(e: TouchEvent) {
  lastTouchAt = performance.now()
  cancelTouch()
  scrollModifiers = 0; touchSource = true; touchPrimed = false
  if (e.touches.length === 1) touch.start(e.touches[0]!.clientX, e.touches[0]!.clientY)
}
function onTouchMove(e: TouchEvent) {
  e.preventDefault()
  if (e.touches.length !== 1) { cancelTouch(); return }
  touch.move(e.touches[0]!.clientX, e.touches[0]!.clientY)
}
function onTouchEnd(e: TouchEvent) {
  lastTouchAt = performance.now()
  const t = e.changedTouches[0]
  // A tap on a link opens it; any simple tap closes the keyboard: the
  // terminal stays readable in full.
  if (touch.end()) {
    // No keyboard for a link: cancels the mousedown that follows the tap.
    if (t) {
      if (props.ctl.tapLink(t.clientX, t.clientY)) e.preventDefault()
      else props.ctl.tapMouse(t.clientX, t.clientY)
    }
    props.ctl.blur()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  } else e.preventDefault()
  // Finger's gone: the leftover displayed debt glides home now instead of
  // riding through the whole momentum tail (that reads as an afterimage).
  settleUnconfirmed()
}
// The layer only receives the mouse on a touch screen (main.css): on a
// computer, xterm receives it directly (selection, mouse mode).
function onMouseDown(e: MouseEvent) {
  const fromTouch = (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents
  // Ignore compatibility mouse events after a touch. Refocusing xterm here
  // can reopen the IME, resize the remote TUI and lose the reading position.
  if (fromTouch || (fromTouch === undefined && performance.now() - lastTouchAt < 700)) return
  props.ctl.focus()
}
// Listened on the whole block, before xterm: on a computer the mouse reaches
// xterm (selection), which would otherwise send the wheel to the program in mouse
// mode. Herdr applies the application's mouse mode itself.
function onWheel(e: WheelEvent) {
  if (touchSource) cancelTouch()
  touchSource = false
  e.preventDefault()
  e.stopPropagation()
  scrollX = e.clientX
  scrollY = e.clientY
  scrollModifiers = (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0)
  const scroller = host.value?.querySelector('.xterm') as HTMLElement | null
  if (scroller && scroller.scrollWidth > scroller.clientWidth && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
    scroller.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX
    return
  }
  const h = props.ctl.rowHeight()
  acc -= wheelPixels(e.deltaY, e.deltaMode, h, props.ctl.pageRows())
  const { lines, rest } = takeLines(acc, h)
  acc = rest
  if (lines) queue(lines)
  applyOffset()
}

let fitTimer: ReturnType<typeof setTimeout> | undefined
// Throttle rather than debounce: long divider drags must keep fitting while
// the pointer moves, without sending every intermediate pixel to Herdr.
function scheduleFit() {
  if (fitTimer) return
  fitTimer = setTimeout(() => {
    fitTimer = undefined
    props.ctl.fitNow(true)
  }, 50)
}
watch(layoutTick, scheduleFit)
let ro: ResizeObserver | null = null
onMounted(() => {
  document.addEventListener('pointerdown', cancelTouch, true)
  props.ctl.mount(host.value!)
  nextTick(() => {
    props.ctl.fitNow(false)
    if (!props.ctl.hasBanner()) props.ctl.connect(false)
  })
  ro = new ResizeObserver(scheduleFit)
  ro.observe(host.value!)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', cancelTouch, true)
  cancelTouch()
  ro?.disconnect()
  clearTimeout(fitTimer)
  clearTimeout(settleTimer)
  cancelAnimationFrame(settleId)
  cancelAnimationFrame(raf)
  props.ctl.dispose()
})
</script>

<template>
  <div id="termWrap" @wheel.capture="onWheel">
    <div id="term" ref="host" />
    <div
      id="touch" aria-hidden="true"
      @touchstart.passive="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd" @touchcancel="cancelTouch"
      @mousedown.prevent="onMouseDown"
    />
    <div v-if="ctl.loading.value" class="term-loading"><span class="spinner" /></div>
    <div v-if="ctl.selectionHint.visible.value" class="terminal-selection-hint">
      {{ tl('Shift + drag to select', 'Shift + glisser pour sélectionner') }}
      <button type="button" :aria-label="t('Hide')" @click="ctl.selectionHint.dismiss()">×</button>
    </div>
  </div>
</template>
