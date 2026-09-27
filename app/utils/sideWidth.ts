// Largeur de la colonne « Projet » (ordinateur), réglée à la poignée et gardée
// sur l'appareil. null : largeur par défaut (CSS).
export const SIDE_MIN = 260
export const SIDE_MAX_RATIO = 0.5
const KEY = 'projectSideWidth'

// Bornes : 260 px au moins, la moitié de la zone au plus (la conversation garde
// l'autre moitié) ; zone trop étroite pour les deux : le minimum l'emporte.
export function clampSideWidth(w: number, area: number): number {
  const max = Math.max(SIDE_MIN, Math.floor(area * SIDE_MAX_RATIO))
  return Math.round(Math.min(max, Math.max(SIDE_MIN, w)))
}

export function readSideWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v >= SIDE_MIN ? Math.round(v) : null
  } catch { return null }
}

export function saveSideWidth(w: number | null) {
  try {
    if (w === null) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(w))
  } catch { /* stockage indisponible */ }
}
