// Bouton flottant « Répondre » près d'un passage sélectionné dans un message
// de l'agent. Au-dessus de la sélection, centré sur elle ; sur ordinateur,
// en dessous s'il n'y a pas la place au-dessus. Sur téléphone jamais en
// dessous : le menu natif de sélection d'iOS et les poignées y sont.
export interface Rect { top: number, bottom: number, left: number, right: number }
export interface Box { width: number, height: number }

export const SEL_GAP = 8
export const SEL_MARGIN = 8

export function selectionReplyPos(sel: Rect, btn: Box, view: { width: number, top: number, bottom: number }, _touch: boolean): { top: number, left: number } | null {
  // Sélection sortie de la zone visible (défilement) : pas de bouton.
  if (sel.bottom < view.top || sel.top > view.bottom) return null
  // Coin inférieur droit de la sélection (au-dessus s'il n'y a pas la place dessous).
  const left = Math.min(Math.max(SEL_MARGIN, sel.right - btn.width), view.width - btn.width - SEL_MARGIN)
  const below = sel.bottom + SEL_GAP
  if (below + btn.height <= view.bottom) return { top: below, left }
  const above = sel.top - SEL_GAP - btn.height
  if (above >= view.top) return { top: above, left }
  return { top: Math.max(view.top, view.bottom - btn.height - SEL_MARGIN), left }
}
