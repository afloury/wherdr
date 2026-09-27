// Balayage horizontal entre les panes d'un onglet (téléphone), pur.

// Axe du geste, décidé une fois le doigt parti de quelques pixels : horizontal
// seulement s'il domine nettement (sinon c'est un défilement de la conversation).
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | null {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < 10) return null
  return ax > ay * 1.3 ? 'x' : 'y'
}

// Fin du geste : +1 = pane suivant (doigt vers la gauche), -1 = précédent, 0 = rien.
// Assez loin (un quart d'écran), ou un coup rapide.
export function swipeStep(dx: number, ms: number, width: number): 1 | -1 | 0 {
  const ax = Math.abs(dx)
  const far = ax >= Math.max(60, width * 0.25)
  const flick = ax >= 36 && ax / Math.max(ms, 1) > 0.45
  if (!far && !flick) return 0
  return dx < 0 ? 1 : -1
}

// Décalage affiché pendant le geste : amorti, et freiné au bord (pas de voisin).
export function swipeOffset(dx: number, canGo: boolean): number {
  return Math.round(canGo ? dx * 0.55 : dx * 0.18)
}
