import type { HerdrState, Pane, Workspace } from '../../shared/types'

export type CloseKind = 'pane' | 'tab' | 'workspace'
export interface ClosePlan {
  group: boolean
  workspaces: Workspace[]
  panes: Pane[]
}

// Herdr requires explicit group intent when the primary workspace closes while
// linked checkouts remain open. A pane/tab close can close that workspace too.
export function planClose(state: HerdrState, kind: CloseKind, id: string): ClosePlan {
  const pane = kind === 'pane' ? state.panes.find(p => p.id === id) : undefined
  const tab = kind === 'tab' ? state.tabs?.find(t => t.id === id) : undefined
  const wsId = kind === 'workspace' ? id : pane?.workspace || tab?.workspace
  const ws = state.workspaces.find(w => w.id === wsId)
  if (!ws) return { group: false, workspaces: [], panes: [] }
  const wsPanes = state.panes.filter(p => p.workspace === ws.id)
  const closesWorkspace = kind === 'workspace'
    || kind === 'pane' && wsPanes.length === 1
    || kind === 'tab' && (state.tabs || []).filter(t => t.workspace === ws.id).length === 1
  const linked = ws.repo && !ws.worktree && closesWorkspace
    ? state.workspaces.filter(w => w.id !== ws.id && w.machine === ws.machine && w.repo === ws.repo && w.worktree)
    : []
  const workspaces = linked.length ? [ws, ...linked] : [ws]
  const panes = linked.length ? state.panes.filter(p => workspaces.some(w => w.id === p.workspace))
    : kind === 'pane' ? pane ? [pane] : []
      : kind === 'tab' ? state.panes.filter(p => p.tab === id) : wsPanes
  return { group: Boolean(linked.length), workspaces, panes }
}

export interface CheckoutStatus { label: string, modified: number, untracked: number, truncated?: boolean }
export function checkoutMessage(statuses: CheckoutStatus[], group: boolean, tl: (fr: string, en: string) => string): string {
  const parts: string[] = []
  if (group) parts.push(tl('Le groupe de worktrees et tous ses espaces ouverts seront fermés.', 'The worktree group and all its open spaces will close.'))
  parts.push(tl('Les fichiers, les branches et les dossiers de checkout/worktree seront conservés.', 'Files, branches and checkout/worktree directories will be kept.'))
  for (const s of statuses) {
    const count = s.modified + s.untracked
    const prefix = s.truncated ? tl('Au moins ', 'At least ') : ''
    parts.push(count
      ? tl(`⚠ ${s.label} : ${prefix}${s.modified} fichier(s) modifié(s), ${s.untracked} non suivi(s) — modifications non commitées conservées.`, `⚠ ${s.label}: ${prefix}${s.modified} modified, ${s.untracked} untracked file(s) — uncommitted changes will be kept.`)
      : tl(`${s.label} : aucune modification non commitée.`, `${s.label}: no uncommitted changes.`))
  }
  return parts.join('\n')
}
