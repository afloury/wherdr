import type { HerdrState, Pane, Workspace } from '../../shared/types'

export type CloseKind = 'pane' | 'tab' | 'workspace'
export interface ClosePlan {
  workspaces: Workspace[]
  panes: Pane[]
  // What actually disappears with it: the tabs left empty, and whether its
  // space goes too (a pane or tab that was the last one, or the space itself).
  tabs: string[]
  closesWorkspace: boolean
}

export function planClose(state: HerdrState, kind: CloseKind, id: string): ClosePlan {
  const pane = kind === 'pane' ? state.panes.find(p => p.id === id) : undefined
  const tab = kind === 'tab' ? state.tabs?.find(t => t.id === id) : undefined
  const wsId = kind === 'workspace' ? id : pane?.workspace || tab?.workspace
  const ws = state.workspaces.find(w => w.id === wsId)
  if (!ws) return { workspaces: [], panes: [], tabs: [], closesWorkspace: false }
  const wsPanes = state.panes.filter(p => p.workspace === ws.id)
  const closesWorkspace = kind === 'workspace'
    || kind === 'pane' && wsPanes.length === 1
    || kind === 'tab' && (state.tabs || []).filter(t => t.workspace === ws.id).length === 1
  const panes = kind === 'pane' ? pane ? [pane] : []
    : kind === 'tab' ? state.panes.filter(p => p.tab === id) : wsPanes
  const tabs = closesWorkspace
    ? (state.tabs || []).filter(t => t.workspace === ws.id).map(t => t.id)
    : kind === 'tab' ? [id]
      : pane && state.panes.filter(p => p.tab === pane.tab).length === 1 ? [pane.tab] : []
  return { workspaces: [ws], panes, tabs, closesWorkspace }
}

// The structure changed while the confirmation was open: does the close now
// take more than what was shown (another pane, a tab, a space)?
export function widerClose(shown: ClosePlan, now: ClosePlan): boolean {
  const spaces = (x: ClosePlan) => x.closesWorkspace ? x.workspaces.map(w => w.id) : []
  const more = (a: string[], b: string[]) => b.some(id => !a.includes(id))
  return more(shown.panes.map(p => p.id), now.panes.map(p => p.id))
    || more(shown.tabs, now.tabs)
    || more(spaces(shown), spaces(now))
}

// Agents a close interrupts: every pane of the plan that runs one, whatever its status
// (a working agent, one waiting for an answer, one that ended in error).
export function agentsClosing(plan: Pick<ClosePlan, 'panes'>, tl: (en: string, fr: string) => string): string {
  const n = plan.panes.filter(p => p.agent).length
  return n ? (n === 1 ? tl('⚠ 1 agent will be interrupted.', '⚠ 1 agent sera interrompu.') : tl(`⚠ ${n} agents will be interrupted.`, `⚠ ${n} agents seront interrompus.`)) : ''
}
