<script setup lang="ts">
// Live mirror of a pane (side-by-side view, computer, cell without the focus):
// the pane's screen at its real size in Herdr, without ever resizing the real
// terminal (/ws/mirror, Herdr observer). Read only: the focused cell has the
// real terminal (TerminalView). The screen is framed and centred in its cell;
// wider than the cell, its characters shrink until it fits.
// `hold`: the pane was fitted to this cell by its terminal, and keeps that
// size as long as the mirror shows it; a cell resized meanwhile (window,
// divider) asks for a new fit (see server/utils/mirror.ts).
import '@xterm/xterm/css/xterm.css'
import { Terminal } from '@xterm/xterm'
import { mirrorFit, mirrorFontSize, mirrorLeft, mirrorTop } from '~/utils/mirrorViewport'
import { bindTerminalSelection } from '~/utils/terminalSelection'
import { bindTerminalLinks } from '~/utils/terminalLinks'
import { TERM_FONT } from '~/utils/terminalFont'

const props = defineProps<{ paneId: string, hold?: boolean }>()
const box = ref<HTMLElement | null>(null)
const host = ref<HTMLElement | null>(null)
const top = ref(6)
const left = ref(8)
const size = ref('')
// Screen clearly smaller than its cell: a frame shows where it ends.
const framed = ref(false)
const ready = ref(false)
const failed = ref(false)
const selectionHint = useTerminalSelectionHint()

let term: Terminal | null = null
let ws: WebSocket | null = null
let retry = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
let ro: ResizeObserver | null = null
let alive = true
let unbindSelection: (() => void) | null = null
let fontKey = ''
let fontCap = 0
let fitBox = ''
let baseCell: { width: number, height: number } | null = null
let fitTimer: ReturnType<typeof setTimeout> | undefined
let links: ReturnType<typeof bindTerminalLinks> | null = null

// The PTY stays at the Herdr client's size. Too wide for the cell: smaller
// characters; too tall: framed on the cursor line.
function positionScreen() {
  const b = box.value
  const el = term?.element?.querySelector('.xterm-screen') as HTMLElement | null
  if (!term || !b || !el || !el.offsetHeight || !el.offsetWidth) return
  const now = term.options.fontSize || fontSize.value
  if (now === fontSize.value) baseCell = { width: el.offsetWidth / term.cols, height: el.offsetHeight / term.rows }
  // For one width and one screen, the size only goes down: no back and forth
  // between two sizes that measure almost the same.
  const key = `${b.clientWidth} ${term.cols} ${fontSize.value}`
  if (key !== fontKey) {
    fontKey = key
    fontCap = fontSize.value
  }
  const want = Math.min(fontCap, mirrorFontSize(b.clientWidth, term.cols, el.offsetWidth / term.cols / now, fontSize.value))
  // The screen is measured again at the new size (ResizeObserver).
  if (want !== now) {
    fontCap = want
    term.options.fontSize = want
    return
  }
  left.value = mirrorLeft(b.clientWidth, el.offsetWidth)
  top.value = mirrorTop(b.clientHeight, el.offsetHeight, term.buffer.active.cursorY, term.rows)
  size.value = `${term.cols}×${term.rows}`
  framed.value = b.clientWidth - el.offsetWidth > 4 * (el.offsetWidth / term.cols) + 16 || b.clientHeight - el.offsetHeight > 4 * (el.offsetHeight / term.rows) + 12
}

// Held pane: its cell changed size since the terminal fitted it.
function askFit() {
  const b = box.value
  const el = term?.element?.querySelector('.xterm-screen') as HTMLElement | null
  if (!props.hold || !term || !b || !el?.offsetWidth || !ready.value) return
  const key = `${b.clientWidth} ${b.clientHeight} ${fontSize.value}`
  if (key === fitBox) return
  // Use the measured cells at the setting's size. Scaling smaller text back
  // proportionally is inaccurate: xterm rounds character heights to pixels.
  if (!baseCell) return
  const fit = mirrorFit(b.clientWidth, b.clientHeight, baseCell.width, baseCell.height)
  if (!fit || ws?.readyState !== 1) return
  fitBox = key
  ws.send(JSON.stringify({ type: 'fit', ...fit }))
}

function connect() {
  if (!alive || !term || ws) return
  clearTimeout(retryTimer)
  const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/mirror?${new URLSearchParams({ pane: props.paneId, ...(props.hold ? { hold: '1' } : {}) })}`)
  ws = s
  s.onmessage = (e) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let m: any
    try { m = JSON.parse(e.data) }
    catch { return }
    if (!term) return
    if (m.type === 'mirror.size') {
      term.reset()
      term.resize(m.cols, m.rows)
      nextTick(positionScreen)
    } else if (m.type === 'terminal.frame') {
      if (m.width && m.height && (m.width !== term.cols || m.height !== term.rows)) {
        term.resize(m.width, m.height)
        nextTick(positionScreen)
      }
      const current = term
      current.write(b64ToBytes(m.bytes || ''), () => {
        positionScreen()
        selectionHint.refresh(current)
      })
      if (!ready.value) {
        ready.value = true
        failed.value = false
        retry = 0
        nextTick(positionScreen)
      }
    } else if (m.type === 'web.error') {
      toast(m.message, true)
    }
  }
  s.onclose = () => {
    if (ws !== s) return
    ws = null
    if (!alive || document.hidden) return
    if (retry >= 4) {
      failed.value = true
      return
    }
    retryTimer = setTimeout(connect, Math.min(6000, 500 * 2 ** retry++))
  }
}
// `away`: the page is hidden, the mirror comes back (4001: not closed on purpose).
function disconnect(away = false) {
  clearTimeout(retryTimer)
  const s = ws
  ws = null
  if (s) {
    try { s.close(away ? 4001 : 1000) }
    catch { /* already closed */ }
  }
}

onMounted(() => {
  term = new Terminal({
    fontFamily: TERM_FONT, fontSize: fontSize.value, lineHeight: 1, scrollback: 0, cursorBlink: false,
    allowProposedApi: true, disableStdin: true, macOptionClickForcesSelection: true,
    theme: terminalTheme.value, cols: 80, rows: 24,
  })
  term.open(host.value!)
  unbindSelection = bindTerminalSelection(term, () => toast(t('Copied')))
  links = bindTerminalLinks(term, t)
  term.attachCustomWheelEventHandler(() => false)
  document.fonts?.load(`${fontSize.value}px "JetBrains Mono Variable"`).then(() => nextTick(positionScreen)).catch(() => {})
  fitBox = `${box.value!.clientWidth} ${box.value!.clientHeight} ${fontSize.value}`
  ro = new ResizeObserver(() => {
    positionScreen()
    clearTimeout(fitTimer)
    fitTimer = setTimeout(askFit, 250)
  })
  ro.observe(box.value!)
  const screen = term.element?.querySelector('.xterm-screen')
  if (screen) ro.observe(screen)
  connect()
})
onUnmounted(() => {
  alive = false
  ro?.disconnect()
  clearTimeout(fitTimer)
  disconnect()
  unbindSelection?.()
  links?.dispose()
  term?.dispose()
  term = null
})
watch(terminalTheme, (th) => { if (term) term.options.theme = th })
watch(fontSize, (n) => {
  if (!term) return
  baseCell = null
  term.options.fontSize = n
  nextTick(positionScreen)
})
// Hidden page: no more stream; it resumes on return.
watch(pageVisible, (v) => {
  if (!v) return disconnect(true)
  retry = 0
  failed.value = false
  connect()
})
function retryNow() {
  retry = 0
  failed.value = false
  connect()
}
defineExpose({ focus: () => term?.focus() })
</script>

<template>
  <div ref="box" class="mirror">
    <div ref="host" class="mirror-screen" :class="{ framed }" :style="{ top: `${top}px`, left: `${left}px` }" />
    <div v-if="!ready && !failed" class="term-loading"><span class="spinner" /></div>
    <button v-if="failed" type="button" class="mirror-failed" @click="retryNow">
      <UIcon name="i-lucide-refresh-cw" />{{ t('Mirror unavailable · retry') }}
    </button>
    <span class="mirror-tag">{{ t('Mirror') }}<template v-if="size"> · {{ size }}</template></span>
    <div v-if="selectionHint.visible.value" class="terminal-selection-hint">
      {{ tl('Shift + drag to select', 'Shift + glisser pour sélectionner') }}
      <button type="button" :aria-label="t('Hide')" @click="selectionHint.dismiss()">×</button>
    </div>
  </div>
</template>
