// Selection and copy in an xterm terminal (computer), terminal and mirror.
// Plain xterm selection: Herdr keeps the history (scrollback 0 on the xterm
// side), so only what is on screen can be selected, and dragging past the
// edge does not scroll. xterm keeps the selection internally, even with the
// WebGL renderer: copying reads getSelection(), not the DOM selection.
import type { Terminal } from '@xterm/xterm'

type Keys = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>
type Press = Pick<MouseEvent, 'button' | 'shiftKey' | 'altKey'>
type Clipboard = Pick<globalThis.Clipboard, 'writeText'>

// ⌘C (Mac) or Ctrl+Shift+C (elsewhere). Ctrl+C stays with the program.
export function isTerminalCopyKey(e: Keys): boolean {
  return e.key.toLowerCase() === 'c' && !e.altKey && (e.metaKey || (e.ctrlKey && e.shiftKey))
}

// Shift + drag must always start a selection. Without mouse mode, xterm
// takes Shift as "extend the selection" (nothing without an existing
// selection); with it, xterm only forces the selection on a Mac with ⌥. The
// press is then replayed without Shift, with ⌥ on a Mac in mouse mode. wherdr
// declares `mouse_capture: false` to Herdr: mouse mode should not happen.
export function shiftDragPress(e: Press, mac: boolean, mouseTracking: boolean): { shiftKey: boolean, altKey: boolean } | null {
  if (e.button !== 0 || !e.shiftKey || e.altKey) return null
  if (!mouseTracking) return { shiftKey: false, altKey: false }
  return mac ? { shiftKey: false, altKey: true } : null
}

// Herdr paints whole lines, blanks included: xterm keeps those trailing
// spaces in the selection, a native terminal would not.
export function trimSelection(text: string): string {
  return text.replace(/[ \t]+$/gm, '')
}

// One clipboard call, made synchronously so it stays inside the caller's user
// gesture (the copy key, or the release of a drag started by a mousedown).
// A refusal is not reported: the selection stays, ⌘C copies it.
export function copyTerminalText(text: string, clipboard: Clipboard | undefined = globalThis.navigator?.clipboard): Promise<boolean> {
  if (!text || !clipboard?.writeText) return Promise.resolve(false)
  try {
    return clipboard.writeText(text).then(() => true, () => false)
  } catch { return Promise.resolve(false) }
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

// `copied`: discreet feedback once the text is in the clipboard.
export function bindTerminalSelection(term: Terminal, copied?: () => void): () => void {
  const root = term.element
  if (!root) return () => {}
  const mac = isMac()
  const copy = () => {
    if (term.hasSelection()) void copyTerminalText(trimSelection(term.getSelection())).then(ok => ok && copied?.())
  }
  const onKey = (e: KeyboardEvent) => {
    if (!isTerminalCopyKey(e) || !term.hasSelection()) return
    e.preventDefault()
    e.stopPropagation()
    copy()
  }
  // Copy on release (drag, double or triple click): capture phase on the
  // window, so it also runs when the button is released outside the terminal.
  const onUp = () => copy()
  const onDown = (e: MouseEvent) => {
    if (e.button === 0) window.addEventListener('mouseup', onUp, { capture: true, once: true })
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
    window.removeEventListener('mouseup', onUp, { capture: true })
    root.removeEventListener('keydown', onKey, true)
    root.removeEventListener('mousedown', onDown, true)
  }
}
