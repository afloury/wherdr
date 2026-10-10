// Compact list (Settings › Appearance), on unless this device turned it off:
// a missing preference follows the default; a saved choice takes priority.
export function readCompactList(stored: string | null): boolean {
  return stored !== '0'
}

// What a one-line card keeps.
// Badge: the project role, shortened ("coord" for the coordinator, "t-0007"
// for a thread). Space: one state dot per tab when it has several tabs,
// otherwise its number of panes when it has several.
export interface CompactMeta { badge: string | null, dots: boolean, panes: number | null }

export function compactMeta(o: { tag?: string | null, coordinator?: boolean, tabs?: number, panes?: number }): CompactMeta {
  const tabs = o.tabs ?? 0
  const panes = o.panes ?? 0
  return {
    badge: o.coordinator ? 'coord' : (o.tag || null),
    dots: tabs > 1,
    panes: tabs <= 1 && panes > 1 ? panes : null,
  }
}
