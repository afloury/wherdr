// Font stack of the terminals (xterm). "Wherdr Symbols" (lines, blocks,
// agent controls) comes first; "Wherdr Nerd Symbols" fills the Nerd Font
// icons (Private Use Area) after JetBrains Mono. Both faces are declared in
// assets/css/main.css with a unicode-range: a file is only downloaded when
// one of its glyphs is displayed.
export const TERM_FONT = '"Wherdr Symbols", "JetBrains Mono Variable", "JetBrains Mono", "Wherdr Nerd Symbols", ui-monospace, "SF Mono", Menlo, monospace'

/** Run `redraw` each time the document finishes loading a font face. */
export function onFontsLoaded(redraw: () => void): () => void {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (!fonts?.addEventListener) return () => {}
  fonts.addEventListener('loadingdone', redraw)
  return () => fonts.removeEventListener('loadingdone', redraw)
}
