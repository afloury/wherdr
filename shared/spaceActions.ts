// Actions on spaces (workspaces), tabs and panes: building the
// Herdr calls from an app request, and what the app shows of them
// (close confirmation, move destinations). Pure (tested).
// Never zoom, focus or resize: the layout is
// shared with the attached client, we only change it on an explicit gesture.
import type { HerdrState, Pane } from './types'
import { PANE_RE, splitId } from './ids'
import { workspaceTree } from './workspaces'
import { type DropSide, PANE_DIRECTIONS, type PaneDirection } from './layout'

export const WORKSPACE_RE = /^(?:[0-9a-f]{4,32}~)?w[0-9a-z]+$/i
export const TAB_RE = /^(?:[0-9a-f]{4,32}~)?w[0-9a-z]+:t[0-9a-z]+$/i
export const LABEL_MAX = 60

export type SplitDirection = 'right' | 'down'
export type MoveDestination = { tab_id: string } | 'new_tab' | 'new_workspace'

export type SpaceAction =
  | { op: 'tab.create', workspace_id: string, label?: string | null, cwd?: string | null }
  | { op: 'workspace.rename', workspace_id: string, label: string }
  | { op: 'tab.rename', tab_id: string, label: string }
  | { op: 'workspace.close', workspace_id: string, close_group?: boolean }
  | { op: 'tab.close', tab_id: string, close_group?: boolean }
  | { op: 'pane.split', pane_id: string, direction: SplitDirection, cwd?: string | null }
  | { op: 'pane.move', pane_id: string, to: MoveDestination }
  | { op: 'pane.swap', pane_id: string, direction: PaneDirection }
  | { op: 'pane.drop', pane_id: string, target_pane_id: string, side: DropSide }
  | { op: 'layout.ratio', tab_id: string, path: string, ratio: number }
  | { op: 'workspace.move', workspace_id: string, before_workspace_id: string | null }

export const SPACE_OPS = ['tab.create', 'workspace.rename', 'tab.rename', 'workspace.close', 'tab.close', 'pane.split', 'pane.move', 'pane.swap', 'pane.drop', 'layout.ratio', 'workspace.move'] as const

// Herdr call ready to go: target machine ('' = local) and IDs local to it.
export interface HerdrCall { machine: string, method: string, params: Record<string, unknown> }

export class SpaceActionError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
const fail = (code: string, message: string): never => { throw new SpaceActionError(code, message) }

// Clean label: collapsed spaces, 60 characters max.
export const cleanLabel = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX)

function idOf(v: unknown, re: RegExp, what: string) {
  const s = String(v ?? '')
  if (!re.test(s)) fail('bad_id', `invalid ${what}`)
  return splitId(s)
}

// Shell folder of a new pane (absolute path), otherwise Herdr's.
const cleanCwd = (x: unknown) => (typeof x === 'string' && x.startsWith('/') && x.length <= 4096 && !x.includes('\0') ? x : null)

// App request (JSON body, untrusted) -> Herdr call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function spaceCall(body: any): HerdrCall {
  const b = body && typeof body === 'object' ? body : {}
  const op = String(b.op || '')
  switch (op) {
    case 'tab.create': {
      const w = idOf(b.workspace_id, WORKSPACE_RE, 'workspace')
      const label = cleanLabel(b.label)
      const cwd = cleanCwd(b.cwd)
      return { machine: w.machine, method: 'tab.create', params: { workspace_id: w.local, ...(label ? { label } : {}), ...(cwd ? { cwd } : {}), focus: false } }
    }
    case 'workspace.rename':
    case 'tab.rename': {
      const isTab = op === 'tab.rename'
      const x = isTab ? idOf(b.tab_id, TAB_RE, 'tab') : idOf(b.workspace_id, WORKSPACE_RE, 'workspace')
      const label = cleanLabel(b.label)
      if (!label) fail('bad_label', 'empty name')
      return { machine: x.machine, method: op, params: { [isTab ? 'tab_id' : 'workspace_id']: x.local, label } }
    }
    case 'workspace.close': {
      const w = idOf(b.workspace_id, WORKSPACE_RE, 'workspace')
      return { machine: w.machine, method: op, params: { workspace_id: w.local, ...(b.close_group === true ? { close_group: true } : {}) } }
    }
    case 'tab.close': {
      const x = idOf(b.tab_id, TAB_RE, 'tab')
      if (b.close_group === true) return { machine: x.machine, method: 'workspace.close', params: { workspace_id: x.local.split(':')[0], close_group: true } }
      return { machine: x.machine, method: op, params: { tab_id: x.local } }
    }
    case 'pane.split': {
      const p = idOf(b.pane_id, PANE_RE, 'pane')
      const direction = b.direction
      if (direction !== 'right' && direction !== 'down') fail('bad_direction', 'invalid direction')
      const cwd = cleanCwd(b.cwd)
      return { machine: p.machine, method: op, params: { target_pane_id: p.local, direction, ...(cwd ? { cwd } : {}), focus: false } }
    }
    case 'pane.move': {
      const p = idOf(b.pane_id, PANE_RE, 'pane')
      const to = b.to
      let destination: Record<string, unknown>
      if (to === 'new_tab') destination = { type: 'new_tab', workspace_id: p.local.split(':')[0] }
      else if (to === 'new_workspace') destination = { type: 'new_workspace' }
      else if (to && typeof to === 'object') {
        const x = idOf(to.tab_id, TAB_RE, 'tab')
        // Un pane ne passe pas d'une machine à l'autre.
        if (x.machine !== p.machine) fail('bad_machine', 'tab on another machine')
        destination = { type: 'tab', tab_id: x.local, split: 'right' }
      } else return fail('bad_destination', 'invalid destination')
      return { machine: p.machine, method: op, params: { pane_id: p.local, destination, focus: false } }
    }
    case 'pane.swap': {
      // The neighbour is chosen by Herdr (pane.neighbor), then swapSteps.
      const p = idOf(b.pane_id, PANE_RE, 'pane')
      const direction = b.direction
      if (!PANE_DIRECTIONS.includes(direction)) fail('bad_direction', 'invalid direction')
      return { machine: p.machine, method: op, params: { pane_id: p.local, direction } }
    }
    case 'pane.drop': {
      // Drag and drop within the tab: sequence of calls computed by dropSteps.
      const p = idOf(b.pane_id, PANE_RE, 'pane')
      const x = idOf(b.target_pane_id, PANE_RE, 'pane')
      if (x.machine !== p.machine) fail('bad_machine', 'pane on another machine')
      const side = b.side
      if (side !== 'center' && !PANE_DIRECTIONS.includes(side)) fail('bad_direction', 'invalid direction')
      return { machine: p.machine, method: op, params: { pane_id: p.local, target_pane_id: x.local, side } }
    }
    case 'layout.ratio': {
      // Trait de séparation glissé : ratio du split désigné par son chemin
      // dans l'arbre (cf. splitPath), sans toucher au focus.
      const x = idOf(b.tab_id, TAB_RE, 'tab')
      const path = String(b.path ?? '')
      if (!/^[01]{0,32}$/.test(path)) fail('bad_path', 'invalid split')
      const ratio = Number(b.ratio)
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) fail('bad_ratio', 'invalid ratio')
      return {
        machine: x.machine, method: 'layout.set_split_ratio',
        params: { tab_id: x.local, path: [...path].map(c => c === '1'), ratio: Math.round(Math.min(0.95, Math.max(0.05, ratio)) * 1000) / 1000 },
      }
    }
    case 'workspace.move': {
      // Reorder spaces (drag and drop in the list): placed just before
      // another space of the same machine, or at the end (null). By ID rather
      // than by position: correct even if the order changed in the meantime. Herdr
      // renumbers its spaces, the IDs and the focus do not change.
      const w = idOf(b.workspace_id, WORKSPACE_RE, 'workspace')
      let before: string | null = null
      if (b.before_workspace_id != null) {
        const x = idOf(b.before_workspace_id, WORKSPACE_RE, 'workspace')
        if (x.machine !== w.machine) fail('bad_machine', 'space on another machine')
        if (x.local === w.local) fail('bad_destination', 'invalid destination')
        before = x.local
      }
      return { machine: w.machine, method: 'workspace.move_block', params: { workspace_ids: [w.local], before_workspace_id: before } }
    }
    default:
      return fail('bad_op', `unknown action: ${op}`)
  }
}

// What the app keeps from Herdr's response: the pane / tab created or
// moved (app IDs, prefixed for a remote machine).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function spaceResult(call: HerdrCall, r: any): { pane_id?: string, tab_id?: string } {
  const id = (x: unknown) => (x == null ? undefined : call.machine ? `${call.machine}~${x}` : String(x))
  if (!r || typeof r !== 'object') return {}
  if (call.method === 'tab.create') return { tab_id: id(r.tab?.tab_id), pane_id: id(r.root_pane?.pane_id) }
  if (call.method === 'pane.split') return { pane_id: id(r.pane?.pane_id), tab_id: id(r.pane?.tab_id) }
  if (call.method === 'pane.move') {
    const p = r.move_result?.pane
    return { pane_id: id(p?.pane_id), tab_id: id(p?.tab_id) }
  }
  return {}
}

// Swap two neighbouring panes without changing anything else on the Herdr side: pane.swap
// gives focus to the source pane and brings the attached client to its tab.
// Source = the tab's active pane if it is part of the swap (focus unchanged);
// otherwise the focus is given back afterwards, in order: tab's active pane, space's
// active tab, session's active pane. `snap`: the machine's session.snapshot,
// local IDs. Refused in a zoomed tab (Herdr only shows one pane there).
export interface HerdrStep { method: string, params: Record<string, unknown> }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function swapSteps(snap: any, pane: string, target: string | null): HerdrStep[] {
  if (!target || target === pane) fail('no_neighbor', 'no pane on that side')
  const layouts: { tab_id: string, workspace_id: string, zoomed?: boolean, focused_pane_id?: string | null, panes: { pane_id: string }[] }[] = Array.isArray(snap?.layouts) ? snap.layouts : []
  const tab = layouts.find(l => l.panes?.some(p => p.pane_id === pane))
  if (!tab || !tab.panes.some(p => p.pane_id === target)) fail('no_neighbor', 'no pane on that side')
  if (tab!.zoomed) fail('zoomed', 'a pane is zoomed in this tab')
  const tabFocus = tab!.focused_pane_id || null
  const [source, other] = tabFocus === target ? [target!, pane] : [pane, target!]
  return [{ method: 'pane.swap', params: { source_pane_id: source, target_pane_id: other } }, ...refocus(snap, tab!, source)]
}

type SnapTab = { tab_id: string, workspace_id: string, zoomed?: boolean, focused_pane_id?: string | null, panes: { pane_id: string }[] }
// Focus restored as before, in order: tab's active pane, space's
// active tab, session's active pane. `cur`: pane that has the focus
// after the previous steps (null: unknown).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function refocus(snap: any, tab: SnapTab, cur: string | null): HerdrStep[] {
  const layouts: SnapTab[] = Array.isArray(snap?.layouts) ? snap.layouts : []
  const ws = (Array.isArray(snap?.workspaces) ? snap.workspaces : []).find((w: { workspace_id: string }) => w.workspace_id === tab.workspace_id)
  const activeTab = layouts.find(l => l.tab_id === ws?.active_tab_id)
  const steps: HerdrStep[] = []
  for (const f of [tab.focused_pane_id || null, activeTab?.focused_pane_id || null, snap?.focused_pane_id || null]) {
    if (!f || f === cur) continue
    steps.push({ method: 'pane.focus', params: { pane_id: f } })
    cur = f
  }
  return steps
}

// Drag and drop `pane` onto `target` (same tab). Center: swap.
// Edge: Herdr refuses a pane.move within its own tab (same_tab), so the
// pane goes through a temporary tab of its space (same ID, same process)
// then comes back to the right of / below the target; for left / above, a
// swap with the target finishes the job. Focus restored afterwards.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dropSteps(snap: any, pane: string, target: string, side: DropSide): HerdrStep[] {
  if (side === 'center') return swapSteps(snap, pane, target)
  if (!target || target === pane) fail('no_neighbor', 'same pane')
  const layouts: SnapTab[] = Array.isArray(snap?.layouts) ? snap.layouts : []
  const tab = layouts.find(l => l.panes?.some(p => p.pane_id === pane))
  if (!tab || !tab.panes.some(p => p.pane_id === target)) fail('no_neighbor', 'pane in another tab')
  if (tab!.zoomed) fail('zoomed', 'a pane is zoomed in this tab')
  const before = side === 'left' || side === 'up'
  const steps: HerdrStep[] = [
    { method: 'pane.move', params: { pane_id: pane, destination: { type: 'new_tab', workspace_id: tab!.workspace_id }, focus: false } },
    { method: 'pane.move', params: { pane_id: pane, destination: { type: 'tab', tab_id: tab!.tab_id, split: side === 'left' || side === 'right' ? 'right' : 'down', target_pane_id: target }, focus: false } },
  ]
  if (before) steps.push({ method: 'pane.swap', params: { source_pane_id: pane, target_pane_id: target } })
  return [...steps, ...refocus(snap, tab!, before ? pane : null)]
}

// What runs in the panes that a close would stop.
export interface CloseSummary { agents: Pane[], shells: number }
export function closeSummary(panes: Pane[]): CloseSummary {
  return { agents: panes.filter(p => p.agent), shells: panes.filter(p => !p.agent).length }
}

type State = Pick<HerdrState, 'workspaces' | 'panes'> & Partial<Pick<HerdrState, 'tabs'>>

// Destinations of a move: the other tabs of the same machine,
// those of its space first.
export interface MoveTarget { tab_id: string, label: string, workspace: string, workspaceLabel: string, sameWorkspace: boolean, panes: number }
export function moveTargets(s: State, paneId: string): MoveTarget[] {
  const p = s.panes.find(x => x.id === paneId)
  if (!p) return []
  const tree = workspaceTree(s, p.machine || '')
  const out: MoveTarget[] = []
  for (const w of tree) {
    for (const e of w.tabs) {
      if (e.tab.id === p.tab) continue
      out.push({
        tab_id: e.tab.id,
        label: e.tab.label || String(e.tab.number),
        workspace: w.workspace.id,
        workspaceLabel: w.workspace.label,
        sameWorkspace: w.workspace.id === p.workspace,
        panes: e.panes.length,
      })
    }
  }
  return [...out.filter(x => x.sameWorkspace), ...out.filter(x => !x.sameWorkspace)]
}

// Space and tab actions offered from a pane (agent view, long press
// on its card), after the pane's own. New tab always; tabs
// are only renamed and closed if there are several (otherwise
// it is the space); a space reduced to this single pane closes with the pane.
export type SpaceEntry = 'tab.create' | 'tab.rename' | 'tab.close' | 'workspace.rename' | 'workspace.close'
export function paneSpaceEntries(s: State, paneId: string): SpaceEntry[] {
  const p = s.panes.find(x => x.id === paneId)
  if (!p) return []
  const w = workspaceTree(s, p.machine || '').find(x => x.workspace.id === p.workspace)
  const tabs = w ? w.tabs.filter(e => e.panes.length) : []
  const simple = tabs.length <= 1 && tabs.every(e => e.panes.length <= 1)
  return [
    'tab.create',
    ...(tabs.length > 1 ? ['tab.rename', 'tab.close'] as const : []),
    'workspace.rename',
    ...(simple ? [] : ['workspace.close'] as const),
  ]
}
