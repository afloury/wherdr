// Actions sur les espaces (workspaces), onglets et panes : construction des
// appels Herdr à partir d'une demande de l'app, et ce que l'app en montre
// (confirmation de fermeture, destinations d'un déplacement). Pur (testé).
// Jamais de zoom, de focus ni de redimensionnement : la disposition est
// partagée avec le client attaché, on ne la change que sur un geste explicite.
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

// Appel Herdr prêt à partir : machine visée ('' = locale) et IDs locaux à celle-ci.
export interface HerdrCall { machine: string, method: string, params: Record<string, unknown> }

export class SpaceActionError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
const fail = (code: string, message: string): never => { throw new SpaceActionError(code, message) }

// Libellé propre : espaces réduits, 60 caractères max.
export const cleanLabel = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX)

function idOf(v: unknown, re: RegExp, what: string) {
  const s = String(v ?? '')
  if (!re.test(s)) fail('bad_id', `${what} invalide`)
  return splitId(s)
}

// Dossier du shell d'un nouveau pane (chemin absolu), sinon celui de Herdr.
const cleanCwd = (x: unknown) => (typeof x === 'string' && x.startsWith('/') && x.length <= 4096 && !x.includes('\0') ? x : null)

// Demande de l'app (corps JSON, non fiable) -> appel Herdr.
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
      const x = isTab ? idOf(b.tab_id, TAB_RE, 'onglet') : idOf(b.workspace_id, WORKSPACE_RE, 'workspace')
      const label = cleanLabel(b.label)
      if (!label) fail('bad_label', 'nom vide')
      return { machine: x.machine, method: op, params: { [isTab ? 'tab_id' : 'workspace_id']: x.local, label } }
    }
    case 'workspace.close': {
      const w = idOf(b.workspace_id, WORKSPACE_RE, 'workspace')
      return { machine: w.machine, method: op, params: { workspace_id: w.local, ...(b.close_group === true ? { close_group: true } : {}) } }
    }
    case 'tab.close': {
      const x = idOf(b.tab_id, TAB_RE, 'onglet')
      if (b.close_group === true) return { machine: x.machine, method: 'workspace.close', params: { workspace_id: x.local.split(':')[0], close_group: true } }
      return { machine: x.machine, method: op, params: { tab_id: x.local } }
    }
    case 'pane.split': {
      const p = idOf(b.pane_id, PANE_RE, 'pane')
      const direction = b.direction
      if (direction !== 'right' && direction !== 'down') fail('bad_direction', 'direction invalide')
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
        const x = idOf(to.tab_id, TAB_RE, 'onglet')
        // Un pane ne passe pas d'une machine à l'autre.
        if (x.machine !== p.machine) fail('bad_machine', 'onglet d’une autre machine')
        destination = { type: 'tab', tab_id: x.local, split: 'right' }
      } else return fail('bad_destination', 'destination invalide')
      return { machine: p.machine, method: op, params: { pane_id: p.local, destination, focus: false } }
    }
    case 'pane.swap': {
      // Le voisin est choisi par Herdr (pane.neighbor), puis swapSteps.
      const p = idOf(b.pane_id, PANE_RE, 'pane')
      const direction = b.direction
      if (!PANE_DIRECTIONS.includes(direction)) fail('bad_direction', 'direction invalide')
      return { machine: p.machine, method: op, params: { pane_id: p.local, direction } }
    }
    case 'pane.drop': {
      // Glisser-déposer dans l'onglet : suite d'appels calculée par dropSteps.
      const p = idOf(b.pane_id, PANE_RE, 'pane')
      const x = idOf(b.target_pane_id, PANE_RE, 'pane')
      if (x.machine !== p.machine) fail('bad_machine', 'pane d’une autre machine')
      const side = b.side
      if (side !== 'center' && !PANE_DIRECTIONS.includes(side)) fail('bad_direction', 'direction invalide')
      return { machine: p.machine, method: op, params: { pane_id: p.local, target_pane_id: x.local, side } }
    }
    case 'layout.ratio': {
      // Trait de séparation glissé : ratio du split désigné par son chemin
      // dans l'arbre (cf. splitPath), sans toucher au focus.
      const x = idOf(b.tab_id, TAB_RE, 'onglet')
      const path = String(b.path ?? '')
      if (!/^[01]{0,32}$/.test(path)) fail('bad_path', 'split invalide')
      const ratio = Number(b.ratio)
      if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) fail('bad_ratio', 'ratio invalide')
      return {
        machine: x.machine, method: 'layout.set_split_ratio',
        params: { tab_id: x.local, path: [...path].map(c => c === '1'), ratio: Math.round(Math.min(0.95, Math.max(0.05, ratio)) * 1000) / 1000 },
      }
    }
    case 'workspace.move': {
      // Réordonner les espaces (glisser-déposer de la liste) : placé juste avant
      // un autre espace de la même machine, ou à la fin (null). Par ID plutôt
      // que par position : juste même si l'ordre a changé entre-temps. Herdr
      // renumérote ses espaces, les IDs et le focus ne changent pas.
      const w = idOf(b.workspace_id, WORKSPACE_RE, 'workspace')
      let before: string | null = null
      if (b.before_workspace_id != null) {
        const x = idOf(b.before_workspace_id, WORKSPACE_RE, 'workspace')
        if (x.machine !== w.machine) fail('bad_machine', 'espace d’une autre machine')
        if (x.local === w.local) fail('bad_destination', 'destination invalide')
        before = x.local
      }
      return { machine: w.machine, method: 'workspace.move_block', params: { workspace_ids: [w.local], before_workspace_id: before } }
    }
    default:
      return fail('bad_op', `action inconnue : ${op}`)
  }
}

// Ce que l'app retient de la réponse de Herdr : le pane / l'onglet créé ou
// déplacé (IDs de l'app, préfixés pour une machine distante).
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

// Échanger deux panes voisins sans rien changer d'autre côté Herdr : pane.swap
// donne le focus au pane source et amène le client attaché sur son onglet.
// Source = le pane actif de l'onglet s'il est de l'échange (focus inchangé) ;
// sinon on rend ensuite le focus, dans l'ordre : pane actif de l'onglet, onglet
// actif de l'espace, pane actif de la session. `snap` : session.snapshot de la
// machine, IDs locaux. Refusé dans un onglet agrandi (Herdr n'y montre qu'un pane).
export interface HerdrStep { method: string, params: Record<string, unknown> }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function swapSteps(snap: any, pane: string, target: string | null): HerdrStep[] {
  if (!target || target === pane) fail('no_neighbor', 'aucun pane de ce côté')
  const layouts: { tab_id: string, workspace_id: string, zoomed?: boolean, focused_pane_id?: string | null, panes: { pane_id: string }[] }[] = Array.isArray(snap?.layouts) ? snap.layouts : []
  const tab = layouts.find(l => l.panes?.some(p => p.pane_id === pane))
  if (!tab || !tab.panes.some(p => p.pane_id === target)) fail('no_neighbor', 'aucun pane de ce côté')
  if (tab!.zoomed) fail('zoomed', 'un pane est agrandi dans cet onglet')
  const tabFocus = tab!.focused_pane_id || null
  const [source, other] = tabFocus === target ? [target!, pane] : [pane, target!]
  return [{ method: 'pane.swap', params: { source_pane_id: source, target_pane_id: other } }, ...refocus(snap, tab!, source)]
}

type SnapTab = { tab_id: string, workspace_id: string, zoomed?: boolean, focused_pane_id?: string | null, panes: { pane_id: string }[] }
// Focus rendu tel qu'avant, dans l'ordre : pane actif de l'onglet, onglet
// actif de l'espace, pane actif de la session. `cur` : pane qui a le focus
// après les étapes précédentes (null : inconnu).
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

// Glisser-déposer `pane` sur `target` (même onglet). Centre : échange.
// Bord : Herdr refuse un pane.move dans son propre onglet (same_tab), donc le
// pane passe par un onglet temporaire de son espace (même ID, même processus)
// puis revient à droite / en dessous de la cible ; à gauche / au-dessus, un
// échange avec la cible finit le travail. Focus rendu ensuite.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dropSteps(snap: any, pane: string, target: string, side: DropSide): HerdrStep[] {
  if (side === 'center') return swapSteps(snap, pane, target)
  if (!target || target === pane) fail('no_neighbor', 'même pane')
  const layouts: SnapTab[] = Array.isArray(snap?.layouts) ? snap.layouts : []
  const tab = layouts.find(l => l.panes?.some(p => p.pane_id === pane))
  if (!tab || !tab.panes.some(p => p.pane_id === target)) fail('no_neighbor', 'pane d’un autre onglet')
  if (tab!.zoomed) fail('zoomed', 'un pane est agrandi dans cet onglet')
  const before = side === 'left' || side === 'up'
  const steps: HerdrStep[] = [
    { method: 'pane.move', params: { pane_id: pane, destination: { type: 'new_tab', workspace_id: tab!.workspace_id }, focus: false } },
    { method: 'pane.move', params: { pane_id: pane, destination: { type: 'tab', tab_id: tab!.tab_id, split: side === 'left' || side === 'right' ? 'right' : 'down', target_pane_id: target }, focus: false } },
  ]
  if (before) steps.push({ method: 'pane.swap', params: { source_pane_id: pane, target_pane_id: target } })
  return [...steps, ...refocus(snap, tab!, before ? pane : null)]
}

// Ce qui tourne dans les panes qu'une fermeture arrêterait.
export interface CloseSummary { agents: Pane[], shells: number }
export function closeSummary(panes: Pane[]): CloseSummary {
  return { agents: panes.filter(p => p.agent), shells: panes.filter(p => !p.agent).length }
}

type State = Pick<HerdrState, 'workspaces' | 'panes'> & Partial<Pick<HerdrState, 'tabs'>>

// Destinations d'un déplacement : les autres onglets de la même machine,
// ceux de son espace d'abord.
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

// Actions d'espace et d'onglet proposées depuis un pane (vue agent, appui long
// de sa carte), après celles du pane lui-même. Nouvel onglet toujours ; les
// onglets se renomment et se ferment seulement s'il y en a plusieurs (sinon
// c'est l'espace) ; un espace réduit à ce seul pane se ferme avec le pane.
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
