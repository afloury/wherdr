// File browser: show the hidden files (name starting with a dot). Shown by
// default; the choice is kept on the device.
const KEY = 'wherdr.files.hidden'

export function readShowHidden(): boolean {
  try { return localStorage.getItem(KEY) !== '0' } catch { return true }
}

export function saveShowHidden(show: boolean) {
  try { localStorage.setItem(KEY, show ? '1' : '0') } catch { /* stockage indisponible */ }
}
