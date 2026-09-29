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

// --- La sélection suit le texte ------------------------------------------
// Sans historique local (scrollback 0), Herdr renvoie un nouvel écran à chaque
// défilement ; xterm garderait le surlignage aux mêmes coordonnées d'écran. On
// compare donc l'écran avant et après chaque image pour trouver de combien de
// lignes le texte a bougé, et on déplace la sélection d'autant.

// Sélection en coordonnées d'écran (lignes éventuellement hors écran), fin
// exclusive comme getSelectionPosition() ; `lines` = texte des lignes
// couvertes, pour vérifier qu'on surligne toujours le même texte.
export interface TrackedSelection {
  startX: number, startY: number, endX: number, endY: number
  text: string
  lines: string[]
}

// Décalage k tel que la ligne i de l'ancien écran est la ligne i + k du
// nouveau (k > 0 : le texte descend, on remonte dans l'historique). `hint` :
// décalage attendu, préféré à égalité. null : écrans sans rapport.
export function findShift(before: string[], after: string[], hint = 0): number | null {
  const rows = Math.min(before.length, after.length)
  if (!rows) return null
  const order = [hint, 0]
  for (let d = 1; d < rows; d++) order.push(d, -d)
  let best: number | null = null
  let bestScore = 0
  for (const k of new Set(order)) {
    if (Math.abs(k) >= rows) continue
    let seen = 0
    let same = 0
    for (let i = Math.max(0, -k); i < rows && i + k < rows; i++) {
      const a = before[i]!.trimEnd()
      const b = after[i + k]!.trimEnd()
      if (!a && !b) continue
      seen++
      if (a === b) same++
    }
    // Au moins deux lignes non vides en commun, presque toutes identiques.
    if (seen < 2 || same / seen < 0.9) continue
    // Le décalage attendu, s'il colle, l'emporte (écrans répétitifs).
    if (k === hint) return k
    if (same > bestScore) {
      best = k
      bestScore = same
    }
  }
  return best
}

// Partie visible d'une sélection décalée, au format de term.select(), ou null
// si elle est entièrement hors écran.
export function visibleRange(s: Pick<TrackedSelection, 'startX' | 'startY' | 'endX' | 'endY'>, cols: number, rows: number): { column: number, row: number, length: number } | null {
  const sy = Math.max(0, s.startY)
  const sx = s.startY < 0 ? 0 : s.startX
  const ey = Math.min(rows - 1, s.endY)
  const ex = s.endY > rows - 1 ? cols : s.endX
  const length = (ey - sy) * cols + ex - sx
  if (s.endY < 0 || s.startY > rows - 1 || length <= 0) return null
  return { column: sx, row: sy, length }
}

// Le texte des lignes visibles de la sélection est-il toujours à sa place ?
export function selectionIntact(s: TrackedSelection, screen: string[]): boolean {
  for (let i = 0; i < s.lines.length; i++) {
    const y = s.startY + i
    if (y < 0 || y >= screen.length) continue
    if (screen[y]!.trimEnd() !== s.lines[i]!.trimEnd()) return false
  }
  return true
}

function screenLines(term: Terminal): string[] {
  const buf = term.buffer.active
  const out: string[] = []
  for (let y = 0; y < term.rows; y++) out.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '')
  return out
}

export interface SelectionFollower {
  // À appeler une fois l'image écrite (rappel de term.write).
  frame: () => void
  // Lignes demandées à Herdr (positif = vers le haut de l'historique).
  scrolled: (lines: number) => void
  // Texte à copier : la sélection mémorisée, même hors écran.
  text: () => string
  dispose: () => void
}

export function followSelection(term: Terminal): SelectionFollower {
  let tracked: TrackedSelection | null = null
  let last = screenLines(term)
  let hint = 0
  let applying = false

  const capture = () => {
    const p = term.getSelectionPosition()
    if (!p) return null
    const screen = screenLines(term)
    return {
      startX: p.start.x, startY: p.start.y, endX: p.end.x, endY: p.end.y,
      text: term.getSelection(),
      lines: screen.slice(p.start.y, p.end.y + 1),
    }
  }
  const sub = term.onSelectionChange(() => {
    if (applying) return
    // Nouvelle sélection (ou clic qui l'efface) : c'est elle qu'on suit.
    tracked = term.hasSelection() ? capture() : null
  })
  const apply = () => {
    applying = true
    try {
      const r = tracked && visibleRange(tracked, term.cols, term.rows)
      if (r) term.select(r.column, r.row, r.length)
      else term.clearSelection()
    } finally { applying = false }
  }

  return {
    frame() {
      const now = screenLines(term)
      const before = last
      last = now
      const h = hint
      if (!tracked) {
        hint = 0
        return
      }
      if (now.length !== before.length) {
        // Redimensionné : les coordonnées n'ont plus de sens.
        tracked = null
        hint = 0
        return apply()
      }
      if (now.every((l, i) => l === before[i])) return
      hint = 0
      let k = findShift(before, now, h)
      // Grand saut (écrans sans ligne commune) : on se fie aux lignes demandées ;
      // selectionIntact efface si Herdr a buté en haut de l'historique.
      if (k === null && h) k = h
      if (k === null) {
        // Le texte sélectionné n'a pas bougé (sortie ailleurs à l'écran).
        if (selectionIntact(tracked, now)) return
        // Écran sans rapport (autre programme, effacement) : plutôt pas de
        // surlignage que sur le mauvais texte.
        tracked = null
        return apply()
      }
      const moved = { ...tracked, startY: tracked.startY + k, endY: tracked.endY + k }
      tracked = selectionIntact(moved, now) ? moved : null
      apply()
    },
    scrolled(lines) { hint += lines },
    text: () => tracked?.text ?? term.getSelection(),
    dispose: () => sub.dispose(),
  }
}

export function bindTerminalSelection(term: Terminal, follower?: SelectionFollower): () => void {
  const root = term.element
  if (!root) return () => {}
  const mac = isMac()
  const onKey = (e: KeyboardEvent) => {
    if (!isTerminalCopyKey(e)) return
    const text = follower ? follower.text() : term.getSelection()
    if (!text) return
    e.preventDefault()
    e.stopPropagation()
    void navigator.clipboard?.writeText(text).catch(() => {})
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
