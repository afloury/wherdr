// List by state, one row per Herdr space (workspace): a space with a single
// tab and a single pane stays its agent's card; otherwise a space
// card, sorted by its most urgent pane. Tab remembered per space.
// Pure (tested).
import type { HerdrState, Pane, Workspace } from './types'
import { type TabEntry, tabEntry, workspaceTree } from './workspaces'

type State = Pick<HerdrState, 'workspaces' | 'panes'> & Partial<Pick<HerdrState, 'tabs'>>

// Urgency of a pane (smaller = more urgent): your turn, working,
// finished unread, ready, unknown; a terminal without an agent comes after.
const RANK: Record<string, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 }
export const urgency = (p: Pick<Pane, 'agent' | 'status'>) => (p.agent ? RANK[p.status || 'unknown'] ?? 4 : 9)

// Pane representing the space: the most urgent, the first in reading
// order on a tie (tabs in order, then panes of each tab).
export function leadPane<P extends Pick<Pane, 'agent' | 'status'>>(panes: P[]): P | null {
  let best: P | null = null
  for (const p of panes) if (!best || urgency(p) < urgency(best)) best = p
  return best
}

export interface PaneRow { kind: 'pane', key: string, pane: Pane, lead: Pane }
export interface SpaceRow {
  kind: 'space'
  key: string
  workspace: Workspace
  tabs: TabEntry[]
  panes: Pane[]
  lead: Pane
  // Tab of the representative pane (its mini-map).
  leadTab: TabEntry
  sum: { blocked: number, working: number, done: number, agents: number }
  // Pane whose state the card shows when it is not `lead` (coordinator
  // space: a more urgent thread tab, see leadByCoordinator).
  state?: Pane
}
export type Row = PaneRow | SpaceRow

// One row per open space (`machine`: only that one, '' = local).
export function spaceRows(s: State, machine?: string): Row[] {
  return workspaceTree(s, machine).map((w) => {
    const tabs = w.tabs.filter(e => e.panes.length)
    const panes = tabs.flatMap(e => e.panes)
    const lead = leadPane(panes)!
    if (tabs.length === 1 && panes.length === 1) return { kind: 'pane', key: lead.id, pane: lead, lead }
    const n = (st: string) => panes.filter(p => p.agent && p.status === st).length
    return {
      kind: 'space',
      key: w.workspace.id,
      workspace: w.workspace,
      tabs,
      panes,
      lead,
      leadTab: tabs.find(e => e.panes.includes(lead))!,
      sum: { blocked: n('blocked'), working: n('working'), done: n('done'), agents: panes.filter(p => p.agent).length },
    }
  })
}

// Group in the list: that of its representative pane. A shell space
// (no agent) is sorted as an idle space, in Ready, as in Herdr's
// first list.
export type RowGroup = 'blocked' | 'working' | 'ready'
export const isShellRow = (r: Row) => !r.lead.agent
export function rowGroup(r: Row): RowGroup {
  const p = r.lead
  if (p.agent && p.status === 'blocked') return 'blocked'
  if (p.agent && p.status === 'working') return 'working'
  return 'ready'
}

// ------------------------------------------------------------ root terminal
// herdr-projects opens a "root" workspace on a repository's main checkout,
// which holds in Herdr the group of its threads' worktrees. In the
// list, it is not a card: a small "Repository <name> · N worktrees" header
// above the project's threads. A shell space is the root of a repository
// if other spaces of the same machine are worktrees of it: same repository
// according to Herdr (`repo`), otherwise (Herdr without these fields) same folder name
// as herdr-projects worktrees (~/.herdr/worktrees/<repo>/…). The
// counter only sees the worktrees open in Herdr on this machine.
export interface RepoRoot {
  row: Row
  name: string
  // Workspaces open on a worktree of this repository.
  worktrees: string[]
}
const WT_DIR = /\/\.herdr\/worktrees\/([^/]+)\/[^/]+/
const cwdOf = (c: string | null | undefined) => (c || '').replace(/\\/g, '/').replace(/\/+$/, '')

export function repoRoots(s: Pick<HerdrState, 'workspaces' | 'panes'>, rows: Row[]): RepoRoot[] {
  const wsOf = new Map(s.workspaces.map(w => [w.id, w]))
  const panesOf = (ws: string) => s.panes.filter(p => p.workspace === ws)
  // Worktrees: repo (if known) and repository name.
  const trees = s.workspaces.flatMap((w) => {
    const dir = panesOf(w.id).map(p => WT_DIR.exec(cwdOf(p.cwd))?.[1]).find(Boolean)
    if (!w.worktree && !dir) return []
    return [{ id: w.id, machine: w.machine || '', repo: w.repo, name: w.repoName || dir || '' }]
  })
  const best = new Map<string, { number: number, root: RepoRoot }>()
  for (const row of rows) {
    if (!isShellRow(row)) continue
    const ws = wsOf.get(row.lead.workspace)
    if (!ws || ws.worktree || WT_DIR.test(cwdOf(row.lead.cwd))) continue
    const machine = ws.machine || ''
    const name = ws.repoName || cwdOf(row.lead.cwd).split('/').pop() || ''
    const mine = trees.filter(t => t.machine === machine && t.id !== ws.id
      && (ws.repo && t.repo ? t.repo === ws.repo : !ws.repo && Boolean(name) && t.name === name))
    if (!mine.length) continue
    // A single header per repository: herdr-projects sometimes opens several
    // shells at the root (Herdr does not always give their repository, hence the
    // key by covered worktrees); keep the oldest (lowest Herdr number),
    // the others stay ordinary terminals in the list.
    const key = `${machine}\0${mine.map(t => t.id).sort().join(' ')}`
    const kept = best.get(key)
    if (!kept || ws.number < kept.number) best.set(key, { number: ws.number, root: { row, name, worktrees: mine.map(t => t.id) } })
  }
  return [...best.values()].map(b => b.root)
}

// Roots attached to a project: those with a worktree holding one of its panes.
export function projectRoots(roots: RepoRoot[], panes: Pick<Pane, 'workspace'>[]): RepoRoot[] {
  return roots.filter(r => panes.some(p => r.worktrees.includes(p.workspace)))
}

// The Ready group can be split into independent repository lists. Herdr's
// order is kept in each list; a space is unread if a pane has finished.
export function readyLists(rows: Row[], automatic: boolean): Row[][] {
  if (!automatic) return [rows]
  const unread = rows.filter(r => (r.kind === 'space' ? r.panes : [r.pane]).some(p => p.agent && p.status === 'done'))
  const read = rows.filter(r => !unread.includes(r))
  return [unread, read].filter(list => list.length)
}

// Sorting of Ready, within each subgroup: Herdr's order (manually
// reorderable), most recent activity first (last state change of one of
// its panes), or name. `title`: the row's displayed title.
export const READY_SORTS = ['herdr', 'recent', 'name'] as const
export type ReadySort = typeof READY_SORTS[number]
export function sortReady(rows: Row[], sort: ReadySort, title: (r: Row) => string): Row[] {
  if (sort === 'herdr') return rows
  const seq = (r: Row) => Math.max(-1, ...(r.kind === 'space' ? r.panes : [r.pane]).map(p => p.stateSeq ?? -1))
  const key = new Map(rows.map(r => [r, sort === 'recent' ? seq(r) : title(r)]))
  // Stable sort: on a tie (shells without an agent…), Herdr's order stays.
  return [...rows].sort((a, b) => sort === 'recent'
    ? (key.get(b) as number) - (key.get(a) as number)
    : (key.get(a) as string).localeCompare(key.get(b) as string, undefined, { sensitivity: 'base', numeric: true }))
}

// ------------------------------------------------------------ remembered tab
// Last opened tab of each space (workspace -> tab).
export type TabMemory = Record<string, string>

// Tab to open for a space: the last opened one if it still exists, otherwise
// `preferred` (the card's representative tab), otherwise that of the most
// urgent pane, otherwise the first.
export function spaceTab(tabs: Pick<TabEntry, 'tab' | 'panes'>[], memory: TabMemory, workspace: string, preferred?: string): string | null {
  const live = tabs.filter(e => e.panes.length)
  const kept = memory[workspace]
  if (kept && live.some(e => e.tab.id === kept)) return kept
  if (preferred && live.some(e => e.tab.id === preferred)) return preferred
  const lead = leadPane(live.flatMap(e => e.panes))
  return (lead && live.find(e => e.panes.includes(lead))?.tab.id) || live[0]?.tab.id || null
}

// ------------------------------------------------------------ after a close
// Like Herdr: closing a tab shows its neighbour (the previous one, the next one
// if it was the first); closing a pane stays in its tab if any
// remain; the list only when the space has nothing left. Decided before
// the call, from the known state: no bounce to the list nor ghost
// tab while waiting for Herdr's next state.
export type Closing = { tab: string } | { pane: string } | { workspace: string }
// Open view: a tab (plan, side by side) or a pane.
export type Viewed = { tab: string } | { pane: string }
// Where to go: a tab, a pane (tab with a single pane), the list; null = stay.
export type Landing = { tab: string } | { pane: string } | 'home' | null

// Live tabs (with panes) of a space, in Herdr's order.
function liveTabs(s: State, workspace: string): TabEntry[] {
  const ws = s.workspaces.find(w => w.id === workspace)
  if (!ws) return []
  return workspaceTree(s, ws.machine || '').find(w => w.workspace.id === workspace)?.tabs.filter(e => e.panes.length) || []
}

// Neighbouring tab of `tab` in its space (previous, otherwise next), null if it is alone.
export function neighborTab(s: State, tab: string): string | null {
  const ws = s.panes.find(p => p.tab === tab)?.workspace ?? s.tabs?.find(t => t.id === tab)?.workspace
  if (!ws) return null
  const tabs = liveTabs(s, ws)
  const i = tabs.findIndex(e => e.tab.id === tab)
  if (i < 0) return null
  return (tabs[i - 1] ?? tabs[i + 1])?.tab.id ?? null
}

// View of a tab: the pane if it is alone, otherwise the tab (plan, side by side).
const landOn = (tab: string, panes: Pick<Pane, 'id'>[]): Landing => (panes.length === 1 ? { pane: panes[0]!.id } : { tab })

export function afterClose(s: State, closing: Closing, viewed: Viewed | null): Landing {
  if (!viewed) return null
  const vPane = 'pane' in viewed ? s.panes.find(p => p.id === viewed.pane) : undefined
  const vTab = 'tab' in viewed ? viewed.tab : vPane?.tab
  const vWs = vPane?.workspace ?? s.panes.find(p => p.tab === vTab)?.workspace
  if ('workspace' in closing) return vWs === closing.workspace ? 'home' : null
  const toNeighbor = (tab: string): Landing => {
    const n = neighborTab(s, tab)
    return n ? landOn(n, s.panes.filter(p => p.tab === n)) : 'home'
  }
  if ('tab' in closing) return vTab === closing.tab ? toNeighbor(closing.tab) : null
  const p = s.panes.find(x => x.id === closing.pane)
  if (!p || vTab !== p.tab) return null
  // Another pane of the tab is open: it stays.
  if (vPane && vPane.id !== p.id) return null
  const rest = (tabEntry(s, p.tab)?.panes || []).filter(x => x.id !== p.id)
  if (!rest.length) return toNeighbor(p.tab)
  // Plan or side by side of several panes: we stay there.
  if ('tab' in viewed && rest.length > 1) return null
  return landOn(p.tab, rest)
}

// Memory updated, limited to spaces still open (`open`) if they are known.
export function rememberTab(memory: TabMemory, workspace: string, tab: string, open?: string[]): TabMemory {
  const next: TabMemory = { ...memory, [workspace]: tab }
  if (!open) return next
  const keep = new Set(open)
  return Object.fromEntries(Object.entries(next).filter(([w]) => keep.has(w)))
}

// ------------------------------------------------------------ reorder
// Drag and drop of a card within its group (same machine, same
// state): a group's order is Herdr's, so dropping a card between
// two neighbours places it, in Herdr, just before the lower neighbour; at the
// bottom of the group, just after the last one (before the space that follows it in
// Herdr, or at the end). The other spaces do not move.

// Herdr order after placing `moving` before `before` (null: at the end).
export function applyMove(order: string[], moving: string, before: string | null): string[] {
  const rest = order.filter(id => id !== moving)
  const i = before === null ? -1 : rest.indexOf(before)
  if (i < 0) return [...rest, moving]
  return [...rest.slice(0, i), moving, ...rest.slice(i)]
}

// `order`: the machine's spaces in Herdr's order; `group`: those of the
// group, in displayed order; `slot`: targeted gap (0 = before the
// first card, group.length = after the last). null: nothing changes.
export function reorderTarget(order: string[], group: string[], moving: string, slot: number): { before: string | null } | null {
  const from = group.indexOf(moving)
  if (from < 0 || !order.includes(moving)) return null
  const rest = group.filter(id => id !== moving)
  const k = Math.max(0, Math.min(rest.length, slot > from ? slot - 1 : slot))
  if (!rest.length) return null
  let before: string | null
  if (k < rest.length) before = rest[k]!
  else {
    const others = order.filter(id => id !== moving)
    before = others[others.indexOf(rest[rest.length - 1]!) + 1] ?? null
  }
  const next = applyMove(order, moving, before)
  return next.every((id, i) => id === order[i]) ? null : { before }
}

// Spaces renumbered as Herdr will do (immediate feedback while waiting for its state).
export function reorderWorkspaces<W extends Pick<Workspace, 'id' | 'number'> & { machine?: string }>(list: W[], moving: string, before: string | null): W[] {
  const m = list.find(w => w.id === moving)
  if (!m) return list
  const machine = m.machine || ''
  const order = list.filter(w => (w.machine || '') === machine).sort((a, b) => a.number - b.number).map(w => w.id)
  const rank = new Map(applyMove(order, moving, before).map((id, i) => [id, i + 1]))
  return list.map(w => (rank.has(w.id) ? { ...w, number: rank.get(w.id)! } : w))
}
