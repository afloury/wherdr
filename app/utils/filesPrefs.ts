// File browser: show the hidden files (name starting with a dot). Shown by
// default; the choice is kept on the device.
const KEY = 'wherdr.files.hidden'

export function readShowHidden(): boolean {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function saveShowHidden(show: boolean) {
  try { localStorage.setItem(KEY, show ? '1' : '0') } catch { /* stockage indisponible */ }
}

// A Markdown file: shown formatted ('rendered') or as its raw text with line
// numbers ('source'). Formatted by default; the choice is kept on the device.
export type MdView = 'rendered' | 'source'
const MD_KEY = 'wherdr.files.md'

export function readMdView(): MdView {
  try { return localStorage.getItem(MD_KEY) === 'source' ? 'source' : 'rendered' } catch { return 'rendered' }
}

export function saveMdView(view: MdView) {
  try { localStorage.setItem(MD_KEY, view) } catch { /* storage unavailable */ }
}
