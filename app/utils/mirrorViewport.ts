// Keeps the cursor line visible if the Herdr screen exceeds its cell.
// The mirror does not resize the PTY shared with the Herdr client.
export function mirrorTop(boxHeight: number, screenHeight: number, cursorRow: number, rows: number, padding = 6): number {
  if (rows <= 0 || screenHeight <= 0) return padding
  const cursorBottom = (Math.min(Math.max(0, cursorRow), rows - 1) + 1) * screenHeight / rows
  const lowestTop = Math.min(padding, boxHeight - screenHeight - padding)
  return Math.max(lowestTop, Math.min(padding, boxHeight - cursorBottom - padding))
}

// Smallest font of a mirror: below, the screen is cropped rather than shrunk.
export const MIRROR_MIN_FONT = 8

// Font size at which a screen of `cols` columns fits the width of its cell:
// the setting's size when it fits, smaller (by tenths of a pixel) when the Herdr
// terminal is wider than the cell. `cellRatio`: width of a character per pixel
// of font size.
export function mirrorFontSize(boxWidth: number, cols: number, cellRatio: number, base: number, padding = 8): number {
  if (cols <= 0 || cellRatio <= 0 || boxWidth <= 0) return base
  const fit = Math.floor(((boxWidth - 2 * padding) / (cols * cellRatio)) * 10) / 10
  return Math.max(Math.min(MIRROR_MIN_FONT, base), Math.min(base, fit))
}

// A screen narrower than its cell is centred; a wider one starts at the left edge.
export function mirrorLeft(boxWidth: number, screenWidth: number, padding = 8): number {
  return Math.max(padding, Math.round((boxWidth - screenWidth) / 2))
}

// Columns and rows that fill a cell, for characters of the given size.
export function mirrorFit(boxWidth: number, boxHeight: number, cellWidth: number, cellHeight: number, padX = 8, padY = 6) {
  if (cellWidth <= 0 || cellHeight <= 0) return null
  return {
    cols: Math.max(10, Math.floor((boxWidth - 2 * padX) / cellWidth)),
    rows: Math.max(5, Math.floor((boxHeight - 2 * padY) / cellHeight)),
  }
}
