// Molette et glissé dans le terminal -> lignes de terminal.scroll pour Herdr.
// xterm.js ne voit que les images redessinées par Herdr (jamais les modes souris
// de l'application) : laissé à lui, il convertit la molette en ↑/↓ (« alternate
// scroll ») et Claude Code parcourt l'historique de ses messages. Herdr, lui,
// connaît le vrai mode : il fait défiler l'historique du pane, ou transmet la
// molette en événements souris si l'application suit la souris.

// WheelEvent.deltaMode : 0 = pixels, 1 = lignes (Firefox), 2 = pages.
export function wheelPixels(deltaY: number, deltaMode: number, rowHeight: number, pageRows: number): number {
  if (deltaMode === 1) return deltaY * rowHeight
  if (deltaMode === 2) return deltaY * rowHeight * Math.max(1, pageRows)
  return deltaY
}

// Déplacement cumulé en pixels (positif = vers le haut de l'historique) ->
// lignes entières à faire défiler et reste gardé pour le prochain événement.
export function takeLines(acc: number, rowHeight: number): { lines: number, rest: number } {
  const h = rowHeight > 0 ? rowHeight : 16
  const lines = Math.trunc(acc / h)
  return { lines, rest: acc - lines * h }
}
