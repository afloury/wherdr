<script setup lang="ts">
// Terminal brut du pane : xterm.js + calque tactile (défilement au doigt ou à
// la molette -> terminal.scroll, l'historique vit dans Herdr ; jamais de ↑/↓
// envoyées à l'agent ; clic = clavier au terminal).
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
function onTouchEnd() {
  lastY = null
  lastX = null
  // Un simple tap referme le clavier : le terminal reste lisible en entier.
  if (!moved) {
    props.ctl.blur()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }
}
// Le calque ne reçoit la souris que sur écran tactile (main.css) : sur
// ordinateur, xterm la reçoit directement (sélection, mode souris).
function onMouseDown() { props.ctl.focus() }
// Écouté sur tout le bloc, avant xterm : sur ordinateur la souris atteint
// xterm (sélection), qui enverrait sinon la molette au programme en mode
// souris. Herdr applique lui-même le mode souris de l'application.
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
watch(layoutTick, () => {
  clearTimeout(fitTimer)
  fitTimer = setTimeout(() => props.ctl.fitNow(true), 120)
})
let ro: ResizeObserver | null = null
onMounted(() => {
  props.ctl.mount(host.value!)
  nextTick(() => {
    props.ctl.fitNow(false)
    if (!props.ctl.hasBanner()) props.ctl.connect(false)
  })
  ro = new ResizeObserver(() => {
    clearTimeout(fitTimer)
    fitTimer = setTimeout(() => props.ctl.fitNow(true), 120)
  })
  ro.observe(host.value!)
})
onUnmounted(() => {
  ro?.disconnect()
  clearTimeout(fitTimer)
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
      {{ tl('Shift + glisser pour sélectionner', 'Shift + drag to select') }}
      <button type="button" :aria-label="t('Masquer')" @click="ctl.selectionHint.dismiss()">×</button>
    </div>
  </div>
</template>
