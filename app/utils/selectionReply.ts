// Bouton flottant « Répondre » près d'un passage sélectionné dans un message
// de l'agent. Au-dessus de la sélection, centré sur elle ; sur ordinateur,
// en dessous s'il n'y a pas la place au-dessus. Sur téléphone jamais en
// dessous : le menu natif de sélection d'iOS et les poignées y sont.
export interface Rect { top: number, bottom: number, left: number, right: number }
export interface Box { width: number, height: number }

export const SEL_GAP = 8
export const SEL_MARGIN = 8

export function selectionReplyPos(sel: Rect, btn: Box, view: { width: number, top: number, bottom: number }, touch: boolean): { top: number, left: number } | null {
  // Sélection sortie de la zone visible (défilement) : pas de bouton.
  if (sel.bottom < view.top || sel.top > view.bottom) return null
  const center = (sel.left + sel.right) / 2
  const left = Math.min(Math.max(SEL_MARGIN, center - btn.width / 2), view.width - btn.width - SEL_MARGIN)
  const above = sel.top - SEL_GAP - btn.height
  if (above >= view.top) return { top: above, left }
  if (!touch && sel.bottom + SEL_GAP + btn.height <= view.bottom) return { top: sel.bottom + SEL_GAP, left }
  return { top: view.top, left }
}
