// Bouton flottant « Répondre » près d'un passage sélectionné dans un message
// de l'agent. Ancré sur la fin logique de la sélection (dernier caractère,
// dernière ligne), même si elle a été faite en remontant : le bouton « clôt »
// le passage comme un curseur de fin, et un ancrage au point de relâchement
// en haut à gauche tomberait sur le texte qui précède.
// Ordinateur : juste à droite du dernier caractère, centré sur sa ligne ; s'il
// déborde à droite, sous la fin de la dernière ligne, aligné à droite sur le
// dernier mot. Téléphone : toujours sous la dernière ligne, assez bas pour
// laisser la poignée de fin (le menu natif d'iOS est au-dessus).
// Il n'apparaît qu'une fois la sélection stable (cf. createSelectionSettler).
export interface Rect { top: number, bottom: number, left: number, right: number }
export interface Box { width: number, height: number }
export interface View { width: number, top: number, bottom: number }

export const SEL_GAP = 6
export const SEL_MARGIN = 8
// Sous la poignée de fin d'iOS / Android (boule d'environ 12 px sous la ligne).
export const SEL_TOUCH_GAP = 22

// Rectangle de la dernière ligne : le dernier rectangle non vide de
// range.getClientRects() (les rectangles vides viennent des fins de bloc).
export function lastLineRect(rects: ArrayLike<Rect>): Rect | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]!
    if (r.right - r.left > 0.5 && r.bottom - r.top > 0.5) return r
  }
  return null
}

export function selectionReplyPos(end: Rect, btn: Box, view: View, touch: boolean): { top: number, left: number } | null {
  // Fin de sélection sortie de la zone visible (défilement) : pas de bouton.
  if (end.bottom < view.top || end.top > view.bottom) return null
  const maxLeft = view.width - btn.width - SEL_MARGIN
  const underLeft = Math.min(Math.max(SEL_MARGIN, end.right - btn.width), maxLeft)
  const gapBelow = touch ? SEL_TOUCH_GAP : SEL_GAP
  const below = end.bottom + gapBelow
  if (!touch && end.right + SEL_GAP <= maxLeft) {
    // Sur la ligne, après le dernier caractère : ne couvre jamais la sélection.
    const top = Math.round(end.top + (end.bottom - end.top - btn.height) / 2)
    return { top: Math.min(Math.max(top, view.top), view.bottom - btn.height), left: end.right + SEL_GAP }
  }
  if (below + btn.height <= view.bottom) return { top: below, left: underLeft }
  // Pas la place dessous : au-dessus de la dernière ligne (ordinateur seulement,
  // le menu natif du téléphone occupe le dessus).
  const above = end.top - SEL_GAP - btn.height
  if (!touch && above >= view.top) return { top: above, left: underLeft }
  return { top: Math.max(view.top, view.bottom - btn.height - SEL_MARGIN), left: underLeft }
}

// Délais avant apparition : après relâchement, après une modification au
// clavier (Maj+flèches) sans relâchement, et au téléphone (ajustement des poignées).
export const SETTLE_POINTER = 180
export const SETTLE_KEYBOARD = 350
export const SETTLE_TOUCH = 380
export const SETTLE_SCROLL = 160

// Décide quand montrer le bouton : jamais pendant le glissé, seulement après
// un délai de stabilité ; tout changement le cache aussitôt.
export function createSelectionSettler(o: { show: () => void, hide: () => void, touch: () => boolean }) {
  let pressed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (timer) clearTimeout(timer); timer = null }
  const later = (ms: number) => { clear(); timer = setTimeout(() => { timer = null; if (!pressed) o.show() }, ms) }
  return {
    down() { pressed = true; clear(); o.hide() },
    up() { if (!pressed) return; pressed = false; later(o.touch() ? SETTLE_TOUCH : SETTLE_POINTER) },
    // Sélection modifiée. `same` : rien n'a bougé (évènement parasite), on garde le bouton.
    change(same = false) {
      if (same) return
      o.hide()
      if (pressed) { clear(); return }
      later(o.touch() ? SETTLE_TOUCH : SETTLE_KEYBOARD)
    },
    scroll() { o.hide(); if (!pressed) later(SETTLE_SCROLL) },
    dispose() { clear() },
  }
}

// Longueur d'un morceau de texte sans ses blancs de fin (espaces, sauts de ligne).
// Renvoie le morceau (index) et le décalage juste après son dernier caractère
// non blanc, en partant de la fin ; null si tout est blanc.
export function trimmedEnd(parts: readonly string[]): { index: number, offset: number } | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const offset = parts[i]!.replace(/\s+$/u, '').length
    if (offset > 0) return { index: i, offset }
  }
  return null
}

// Plage rognée au contenu d'un message : un triple-clic ou un glissé jusqu'au
// bout déborde souvent (pied « Répondre », message suivant, liste) et finit par
// un saut de ligne. On garde le début, on coupe la fin au contenu, puis aux
// derniers caractères non blancs. Null si rien de visible ne reste.
export function clampRange(range: Range, content: Node): Range | null {
  const r = range.cloneRange()
  if (!content.contains(r.startContainer)) {
    // Début avant le contenu (dans l'en-tête du message) : on part du contenu.
    if (r.comparePoint(content, 0) < 0) return null
    r.setStart(content, 0)
  }
  if (!content.contains(r.endContainer)) r.setEnd(content, content.childNodes.length)
  const nodes: Text[] = []
  const parts: string[] = []
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!r.intersectsNode(n)) continue
    const from = n === r.startContainer ? r.startOffset : 0
    const to = n === r.endContainer ? r.endOffset : n.data.length
    nodes.push(n)
    parts.push(n.data.slice(from, to))
  }
  const end = trimmedEnd(parts)
  if (!end) return null
  const node = nodes[end.index]!
  r.setEnd(node, (node === r.startContainer ? r.startOffset : 0) + end.offset)
  return r
}
