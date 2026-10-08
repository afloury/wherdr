// Claude Code's settings panel (/usage, /config, /status, /stats): a tab
// row under the "▔▔▔" line, the active tab highlighted:
//
//   Settings  Status   Config   Usage   Stats
//
// The tab list changes between versions (Stats came later), so it is read
// from the screen rather than hard-coded. Words separated by 2+ spaces.
const ROW = /^\s*Settings((?:\s{2,}[A-Z][\w-]*)+)\s*$/

// Tabs of the row, or null when the line is not one (2 tabs at least).
export function tabsOfRow(line: string): string[] | null {
  const m = ROW.exec(line)
  if (!m) return null
  const tabs = m[1]!.trim().split(/\s{2,}/)
  return tabs.length >= 2 ? tabs : null
}

// Index of the settings tab row in the screen's lines (-1: none).
export function settingsRowIndex(lines: readonly string[]): number {
  return lines.findIndex(l => tabsOfRow(l) !== null)
}

// Tabs of the settings panel on screen, or null when it is not open.
export function settingsTabs(text: string | null | undefined): string[] | null {
  if (!text) return null
  const lines = String(text).split('\n')
  const i = settingsRowIndex(lines)
  return i < 0 ? null : tabsOfRow(lines[i]!)
}

// Key legend line of the panel ("Esc to cancel", "d to day · w to week",
// "←/→/tab to switch · ↓ to return · Esc to close"): keyboard help for the
// terminal, not content.
const KEY_SEG = /^(?:esc|escape|enter|return|tab|space|ctrl\+\w|shift\+tab|[a-z]|[←→↑↓](?:\/(?:[←→↑↓]|tab))*)\s+to\s+\S.*$/i
export function isKeyLegend(line: string): boolean {
  const segs = line.trim().split(/\s+·\s+/)
  return segs[0] !== '' && segs.every(s => KEY_SEG.test(s))
}
