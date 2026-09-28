<script setup lang="ts">
// Miroir en direct d'un pane (vue côte à côte, ordinateur) : l'écran du pane à
// sa taille réelle dans Herdr, rogné si nécessaire pour tenir dans la case, sans
// jamais redimensionner le vrai terminal (/ws/mirror, observateur de Herdr).
// `interactive` (case cliquée) : les frappes partent au pane, texte ou touches
// nommées, toujours sans prendre la main sur le terminal.
import '@xterm/xterm/css/xterm.css'
import { Terminal } from '@xterm/xterm'
import { mirrorInput } from '#shared/spaces'
import { mirrorTop } from '~/utils/mirrorViewport'
import { bindTerminalSelection } from '~/utils/terminalSelection'

const props = defineProps<{ paneId: string, interactive?: boolean }>()
const box = ref<HTMLElement | null>(null)
const host = ref<HTMLElement | null>(null)
const top = ref(6)
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

const FONT = '"Wherdr Symbols", "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace'

// Le PTY reste à la taille du client Herdr. Cadrer sur la ligne du curseur
// si la case est trop basse, sans réduire les caractères.
function positionScreen() {
  const b = box.value
  const el = term?.element?.querySelector('.xterm-screen') as HTMLElement | null
  if (!b || !el || !el.offsetHeight) return
  top.value = mirrorTop(b.clientHeight, el.offsetHeight, term!.buffer.active.cursorY, term!.rows)
}

function connect() {
  if (!alive || !term || ws) return
  clearTimeout(retryTimer)
  const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/mirror?${new URLSearchParams({ pane: props.paneId })}`)
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
function disconnect() {
  clearTimeout(retryTimer)
  const s = ws
  ws = null
  if (s) {
    try { s.close(1000) }
    catch { /* déjà fermée */ }
  }
}
function send(obj: unknown) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', ...obj as object }))
}

onMounted(() => {
  term = new Terminal({
    fontFamily: FONT, fontSize: fontSize.value, lineHeight: 1, scrollback: 0, cursorBlink: false,
    allowProposedApi: true, disableStdin: !props.interactive, macOptionClickForcesSelection: true,
    theme: terminalTheme.value, cols: 80, rows: 24,
  })
  term.open(host.value!)
  unbindSelection = bindTerminalSelection(term)
  term.attachCustomWheelEventHandler(() => false)
  term.onData((d) => {
    if (!props.interactive) return
    for (const x of mirrorInput(d)) send(x)
  })
  document.fonts?.load(`${fontSize.value}px "JetBrains Mono Variable"`).then(() => nextTick(positionScreen)).catch(() => {})
  ro = new ResizeObserver(() => positionScreen())
  ro.observe(box.value!)
  const screen = term.element?.querySelector('.xterm-screen')
  if (screen) ro.observe(screen)
  connect()
})
onUnmounted(() => {
  alive = false
  ro?.disconnect()
  disconnect()
  unbindSelection?.()
  term?.dispose()
  term = null
})
watch(terminalTheme, (th) => { if (term) term.options.theme = th })
watch(fontSize, (n) => {
  if (!term) return
  term.options.fontSize = n
  nextTick(positionScreen)
})
watch(() => props.interactive, (on) => {
  if (!term) return
  term.options.disableStdin = !on
  if (on) nextTick(() => term?.focus())
  else term.blur()
})
// Page cachée : plus de flux ; il reprend au retour.
watch(pageVisible, (v) => {
  if (!v) return disconnect()
  retry = 0
  failed.value = false
  connect()
})
function retryNow() {
  retry = 0
  failed.value = false
  connect()
}
function focusIf() { if (props.interactive) term?.focus() }
defineExpose({ focus: () => term?.focus() })
</script>

<template>
  <div ref="box" class="mirror" :class="{ interactive }" @mousedown="focusIf">
    <div ref="host" class="mirror-screen" :style="{ top: `${top}px` }" />
    <div v-if="!ready && !failed" class="term-loading"><span class="spinner" /></div>
    <button v-if="failed" type="button" class="mirror-failed" @click="retryNow">
      <UIcon name="i-lucide-refresh-cw" />{{ t('Miroir indisponible · réessayer') }}
    </button>
    <span class="mirror-tag">{{ interactive ? t('Saisie directe') : t('Miroir') }}</span>
    <div v-if="selectionHint.visible.value" class="terminal-selection-hint">
      {{ tl('Shift + glisser pour sélectionner', 'Shift + drag to select') }}
      <button type="button" :aria-label="t('Masquer')" @click="selectionHint.dismiss()">×</button>
    </div>
  </div>
</template>
