<script setup lang="ts">
// Raw terminal of the pane: xterm.js + touch layer (scrolling with a finger or
// the wheel -> terminal.scroll, the history lives in Herdr; never ↑/↓
// sent to the agent; click = keyboard to the terminal).
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{ ctl: TerminalCtl }>()
const host = ref<HTMLElement | null>(null)

let lastY: number | null = null
let lastX: number | null = null
let acc = 0
let pendingLines = 0
let raf = 0
let moved = false
const flush = () => {
  raf = 0
  if (!pendingLines) return
  props.ctl.scroll(pendingLines)
  pendingLines = 0
}
const queue = (n: number) => {
  pendingLines += n
  if (!raf) raf = requestAnimationFrame(flush)
}
function onTouchStart(e: TouchEvent) {
  lastY = e.touches[0]!.clientY
  lastX = e.touches[0]!.clientX
  acc = 0
  moved = false
}
function onTouchMove(e: TouchEvent) {
  e.preventDefault()
  if (lastY === null) return
  const y = e.touches[0]!.clientY
  const x = e.touches[0]!.clientX
  const dx = lastX === null ? 0 : x - lastX
  const dy = y - lastY
  lastX = x
  const scroller = host.value?.querySelector('.xterm') as HTMLElement | null
  if (scroller && scroller.scrollWidth > scroller.clientWidth && Math.abs(dx) > Math.abs(dy)) {
    scroller.scrollLeft -= dx
    lastY = y
    moved = true
    return
  }
  acc += dy
  lastY = y
  const { lines, rest } = takeLines(acc, props.ctl.rowHeight())
  acc = rest
  if (lines) {
    moved = true
    queue(lines)
  }
}
function onTouchEnd(e: TouchEvent) {
  const t = e.changedTouches[0]
  lastY = null
  lastX = null
  // A tap on a link opens it; any simple tap closes the keyboard: the
  // terminal stays readable in full.
  if (!moved) {
    // No keyboard for a link: cancels the mousedown that follows the tap.
    if (t && props.ctl.tapLink(t.clientX, t.clientY)) e.preventDefault()
    props.ctl.blur()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }
}
// The layer only receives the mouse on a touch screen (main.css): on a
// computer, xterm receives it directly (selection, mouse mode).
function onMouseDown() { props.ctl.focus() }
// Listened on the whole block, before xterm: on a computer the mouse reaches
// xterm (selection), which would otherwise send the wheel to the program in mouse
// mode. Herdr applies the application's mouse mode itself.
function onWheel(e: WheelEvent) {
  e.preventDefault()
  e.stopPropagation()
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
  props.ctl.mount(host.value!)
  nextTick(() => {
    props.ctl.fitNow(false)
    if (!props.ctl.hasBanner()) props.ctl.connect(false)
  })
  ro = new ResizeObserver(scheduleFit)
  ro.observe(host.value!)
})
onUnmounted(() => {
  ro?.disconnect()
  clearTimeout(fitTimer)
  cancelAnimationFrame(raf)
  props.ctl.dispose()
})
</script>

<template>
  <div id="termWrap" @wheel.capture="onWheel">
    <div id="term" ref="host" />
    <div
      id="touch" aria-hidden="true"
      @touchstart.passive="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd"
      @mousedown.prevent="onMouseDown"
    />
    <div v-if="ctl.loading.value" class="term-loading"><span class="spinner" /></div>
    <div v-if="ctl.selectionHint.visible.value" class="terminal-selection-hint">
      {{ tl('Shift + drag to select', 'Shift + glisser pour sélectionner') }}
      <button type="button" :aria-label="t('Hide')" @click="ctl.selectionHint.dismiss()">×</button>
    </div>
  </div>
</template>
