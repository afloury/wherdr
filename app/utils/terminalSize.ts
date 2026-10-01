import type { ContentWidth } from './contentWidth'

// Same width as --read in main.css. The block never exceeds the pane.
export function terminalPixelWidth(panelWidth: number, width: ContentWidth, desktop = true): number {
  if (!desktop) return Math.max(0, panelWidth)
  if (width === 'normal') return Math.min(Math.max(0, panelWidth), 760)
  return Math.min(width === 'wide' ? 1100 : Number.POSITIVE_INFINITY, Math.max(0, panelWidth - 48))
}

// Pixel model of FitAddon's computation, useful to check reading
// widths. The real cell size is measured by FitAddon in the DOM.
export function columnsForWidth(pixelWidth: number, cellWidth: number, horizontalPadding = 20): number {
  if (cellWidth <= 0) return 1
  return Math.max(1, Math.floor((pixelWidth - horizontalPadding) / cellWidth))
}
