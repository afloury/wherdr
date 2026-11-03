// herdr-core: tab map of a space and quick "new tab". Each terminal of a space is a
// tab without layout, so the map is a grid of those terminals (no split, no resize).
import type { Pane } from './types'
import type { TabLayout } from './layout'

// Grid of one cell per terminal, as square as possible, in the order given.
export function spaceMapLayout(workspace: string, panes: string[]): TabLayout {
  const n = Math.max(1, panes.length)
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const w = 40
  const h = 20
  return {
    tab: workspace, workspace, zoomed: false, focused: panes[0] ?? null,
    area: { x: 0, y: 0, width: cols * w, height: rows * h },
    panes: panes.map((pane, i) => ({ pane, rect: { x: (i % cols) * w, y: Math.floor(i / cols) * h, width: w, height: h } })),
  }
}

// Body of POST /api/agents for a new tab "like this one": same kind (a shell stays a
// shell), same folder, same space and machine. Null when the folder is unknown:
// the caller opens the sheet instead.
export function sameTabBody(pane: Pane | undefined, kinds: string[]): Record<string, unknown> | null {
  if (!pane || !pane.cwd) return null
  const kind = pane.agent && kinds.includes(pane.agent) ? pane.agent : 'shell'
  return { ...(pane.machine ? { machine: pane.machine } : {}), kind, cwd: pane.cwd, name: '', workspace: pane.workspace }
}
