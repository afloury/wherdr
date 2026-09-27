// Garde la ligne du curseur visible si l'écran Herdr dépasse sa case.
// Le miroir ne redimensionne pas le PTY partagé avec le client Herdr.
export function mirrorTop(boxHeight: number, screenHeight: number, cursorRow: number, rows: number, padding = 6): number {
  if (rows <= 0 || screenHeight <= 0) return padding
  const cursorBottom = (Math.min(Math.max(0, cursorRow), rows - 1) + 1) * screenHeight / rows
  const lowestTop = Math.min(padding, boxHeight - screenHeight - padding)
  return Math.max(lowestTop, Math.min(padding, boxHeight - cursorBottom - padding))
}
