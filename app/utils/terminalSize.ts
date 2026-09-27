import type { ContentWidth } from './contentWidth'

// Même largeur que --read dans main.css. Le bloc ne dépasse jamais le pane.
export function terminalPixelWidth(panelWidth: number, width: ContentWidth, desktop = true): number {
  if (!desktop) return Math.max(0, panelWidth)
  if (width === 'normal') return Math.min(Math.max(0, panelWidth), 760)
  return Math.min(width === 'wide' ? 1100 : Number.POSITIVE_INFINITY, Math.max(0, panelWidth - 48))
}

// Modèle en pixels du calcul de FitAddon, utile pour vérifier les largeurs de
// lecture. La taille réelle des cellules est mesurée par FitAddon dans le DOM.
export function columnsForWidth(pixelWidth: number, cellWidth: number, horizontalPadding = 20): number {
  if (cellWidth <= 0) return 1
  return Math.max(1, Math.floor((pixelWidth - horizontalPadding) / cellWidth))
}
