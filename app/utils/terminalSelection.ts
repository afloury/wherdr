// Sélection et copie dans un terminal xterm (ordinateur).
// xterm garde la sélection en interne, même avec le moteur WebGL : la copie lit
// getSelection(), pas la sélection DOM du canevas.
import type { Terminal } from '@xterm/xterm'

type Keys = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>
type Press = Pick<MouseEvent, 'button' | 'shiftKey' | 'altKey'>

// ⌘C (Mac) ou Ctrl+Shift+C (ailleurs). Ctrl+C reste au programme.
export function isTerminalCopyKey(e: Keys): boolean {
  return e.key.toLowerCase() === 'c' && !e.altKey && (e.metaKey || (e.ctrlKey && e.shiftKey))
}

// Shift + glisser doit toujours commencer une sélection. Sans mode souris,
// xterm prend Shift pour « étendre la sélection » (rien sans sélection
// existante) ; avec, il ne force la sélection sur Mac qu'avec ⌥. On rejoue
// alors l'appui sans Shift, avec ⌥ sur Mac en mode souris. wherdr déclare
// `mouse_capture: false` à Herdr : le mode souris ne devrait pas arriver.
export function shiftDragPress(e: Press, mac: boolean, mouseTracking: boolean): { shiftKey: boolean, altKey: boolean } | null {
  if (e.button !== 0 || !e.shiftKey || e.altKey) return null
  if (!mouseTracking) return { shiftKey: false, altKey: false }
  return mac ? { shiftKey: false, altKey: true } : null
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export function bindTerminalSelection(term: Terminal): () => void {
  const root = term.element
  if (!root) return () => {}
  const mac = isMac()
  const onKey = (e: KeyboardEvent) => {
    if (!isTerminalCopyKey(e) || !term.hasSelection()) return
    e.preventDefault()
    e.stopPropagation()
    void navigator.clipboard?.writeText(term.getSelection()).catch(() => {})
  }
  const onDown = (e: MouseEvent) => {
    const mods = shiftDragPress(e, mac, term.modes.mouseTrackingMode !== 'none')
    if (!mods) return
    e.preventDefault()
    e.stopImmediatePropagation()
    e.target?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, composed: true, view: window, detail: e.detail,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
      button: e.button, buttons: e.buttons, ctrlKey: e.ctrlKey, metaKey: e.metaKey, ...mods,
    }))
  }
  root.addEventListener('keydown', onKey, true)
  root.addEventListener('mousedown', onDown, true)
  return () => {
    root.removeEventListener('keydown', onKey, true)
    root.removeEventListener('mousedown', onDown, true)
  }
}
