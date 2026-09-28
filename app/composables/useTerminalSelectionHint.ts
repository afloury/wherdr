// Indice « Shift + glisser » : tant que le programme a pris la souris, sur un
// écran à souris, jusqu'à ce qu'on le masque (une fois pour toutes). Herdr ne
// transmet pas le mode souris (mouse_capture: false) : garde-fou si cela change.
import type { Terminal } from '@xterm/xterm'

const HINT_KEY = 'wherdr.mouse-selection-hint.dismissed'
const dismissed = ref(false)
let loaded = false

export function useTerminalSelectionHint() {
  if (!loaded && typeof localStorage !== 'undefined') {
    loaded = true
    try { dismissed.value = localStorage.getItem(HINT_KEY) === '1' }
    catch { /* stockage indisponible */ }
  }
  const mouseMode = ref(false)
  const fine = typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches
  const visible = computed(() => fine && mouseMode.value && !dismissed.value)
  function refresh(term: Terminal) {
    mouseMode.value = term.modes.mouseTrackingMode !== 'none'
  }
  function dismiss() {
    dismissed.value = true
    try { localStorage.setItem(HINT_KEY, '1') }
    catch { /* stockage indisponible */ }
  }
  return { visible, refresh, dismiss }
}
