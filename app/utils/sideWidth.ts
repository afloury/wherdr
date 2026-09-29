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

// Largeur de la barre latérale gauche (liste des agents, ordinateur), réglée à
// la poignée de son bord droit et gardée sur l'appareil. null : 340 px (CSS).
export const LIST_DEFAULT = 340
export const LIST_MIN = 280
export const LIST_MAX = 560
export const LIST_MAX_RATIO = 0.45
const LIST_KEY = 'listWidth'

// Bornes : 280 à 560 px, et 45 % de la fenêtre au plus (l'agent garde le reste) ;
// fenêtre trop étroite : le minimum l'emporte.
export function clampListWidth(w: number, viewport: number): number {
  const max = Math.max(LIST_MIN, Math.min(LIST_MAX, Math.floor(viewport * LIST_MAX_RATIO)))
  return Math.round(Math.min(max, Math.max(LIST_MIN, w)))
}

// Valeur CSS de --side : bornée aussi en CSS, la fenêtre peut rétrécir ensuite.
export function listWidthCss(w: number): string {
  return `clamp(${LIST_MIN}px, ${w}px, ${LIST_MAX_RATIO * 100}vw)`
}

export function readListWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(LIST_KEY))
    return Number.isFinite(v) && v >= LIST_MIN && v <= LIST_MAX ? Math.round(v) : null
  } catch { return null }
}

export function saveListWidth(w: number | null) {
  try {
    if (w === null) localStorage.removeItem(LIST_KEY)
    else localStorage.setItem(LIST_KEY, String(w))
  } catch { /* stockage indisponible */ }
}
