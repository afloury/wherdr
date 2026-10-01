// Width of the "Project" column (computer), set with the handle and kept
// on the device. null: default width (CSS).
export const SIDE_MIN = 260
export const SIDE_MAX_RATIO = 0.5
const KEY = 'projectSideWidth'

// Bounds: at least 260 px, at most half the area (the conversation keeps
// the other half); area too narrow for both: the minimum wins.
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

// Width of the left sidebar (agent list, computer), set with
// the handle on its right edge and kept on the device. null: 340 px (CSS).
export const LIST_DEFAULT = 340
export const LIST_MIN = 280
export const LIST_MAX = 560
export const LIST_MAX_RATIO = 0.45
const LIST_KEY = 'listWidth'

// Bounds: 280 to 560 px, and at most 45 % of the window (the agent keeps the rest);
// window too narrow: the minimum wins.
export function clampListWidth(w: number, viewport: number): number {
  const max = Math.max(LIST_MIN, Math.min(LIST_MAX, Math.floor(viewport * LIST_MAX_RATIO)))
  return Math.round(Math.min(max, Math.max(LIST_MIN, w)))
}

// CSS value of --side: also clamped in CSS, the window may shrink later.
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

// List collapsed to a narrow column (sidebar button), kept on the device.
export const LIST_RAIL = 56
const RAIL_KEY = 'listCollapsed'

export function readListCollapsed(): boolean {
  try { return localStorage.getItem(RAIL_KEY) === '1' }
  catch { return false }
}

export function saveListCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(RAIL_KEY, '1')
    else localStorage.removeItem(RAIL_KEY)
  } catch { /* stockage indisponible */ }
}
