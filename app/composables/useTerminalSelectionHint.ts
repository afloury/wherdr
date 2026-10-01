// "Shift + drag" hint: while the program has taken the mouse, on a
// mouse screen, until it is hidden (once and for all). Herdr does not
// pass the mouse mode on (mouse_capture: false): a safeguard if that changes.
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
