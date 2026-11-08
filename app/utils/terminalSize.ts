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

interface SizedTerminal {
  element?: HTMLElement
  // xterm's private render service: the measured cell size (as FitAddon reads it).
  _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number, height: number } } } } }
}

// FitAddon.proposeDimensions without its scrollbar allowance: with scrollback on
// (herdr-core), FitAddon takes 15 px off for xterm's scrollbar, which main.css
// hides (.xterm-viewport overflow-y: hidden). That cost 2 columns once the
// stream was known, so "Fit to this screen" gave fewer columns than an open.
export function proposeTerminalSize(term: SizedTerminal, style: (e: Element) => CSSStyleDeclaration = e => getComputedStyle(e)): { cols: number, rows: number } | undefined {
  const element = term.element
  const parent = element?.parentElement
  const cell = term._core?._renderService?.dimensions?.css?.cell
  if (!element || !parent || !cell || !cell.width || !cell.height) return undefined
  const px = (s: CSSStyleDeclaration, name: string) => Number.parseInt(s.getPropertyValue(name)) || 0
  const p = style(parent)
  const e = style(element)
  const width = Math.max(0, px(p, 'width')) - px(e, 'padding-left') - px(e, 'padding-right')
  const height = px(p, 'height') - px(e, 'padding-top') - px(e, 'padding-bottom')
  return { cols: Math.max(2, Math.floor(width / cell.width)), rows: Math.max(1, Math.floor(height / cell.height)) }
}
