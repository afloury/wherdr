// Espaces de travail pour l'app : workspaces → onglets → panes (ordre de
// lecture), avec la disposition à afficher. Pur (testé).
import type { HerdrState, Pane, Tab, Workspace } from './types'
import { type TabLayout, readingOrder, tabLayout } from './layout'

export interface TabEntry { tab: Tab, layout: TabLayout, panes: Pane[] }
export interface WorkspaceEntry { workspace: Workspace, tabs: TabEntry[] }
type State = Pick<HerdrState, 'workspaces' | 'panes'> & Partial<Pick<HerdrState, 'tabs'>>

const byNumber = (a: { number: number }, b: { number: number }) => a.number - b.number

// Onglets connus : ceux de l'état, sinon (ancien état hors ligne) ceux des panes.
function tabsOf(s: State): Tab[] {
  if (s.tabs) return s.tabs
  const out = new Map<string, Tab>()
  for (const p of s.panes) {
    if (!out.has(p.tab)) out.set(p.tab, { id: p.tab, ...(p.machine ? { machine: p.machine } : {}), workspace: p.workspace, label: p.tabLabel || '', number: out.size + 1, layout: null })
  }
  return [...out.values()]
}

// Disposition de Herdr seulement si elle montre exactement les panes connus
// (un pane tout juste créé ou fermé entre deux lectures) ; sinon, empilés.
function entryOf(tab: Tab, all: Pane[]): TabEntry {
  const mine = all.filter(p => p.tab === tab.id)
  const ids = new Set(mine.map(p => p.id))
  const l = tab.layout
  const exact = l && l.panes.length === ids.size && l.panes.every(p => ids.has(p.pane))
  const layout = tabLayout({ ...tab, layout: exact ? l : null }, mine.map(p => p.id))
  const byId = new Map(mine.map(p => [p.id, p]))
  return { tab, layout, panes: readingOrder(layout).map(p => byId.get(p.pane)!) }
}

// `machine` : seulement cette machine ('' = locale) ; absent = toutes.
export function workspaceTree(s: State, machine?: string): WorkspaceEntry[] {
  const mineM = (x: { machine?: string }) => machine === undefined || (x.machine || '') === machine
  const tabs = tabsOf(s).filter(mineM)
  return s.workspaces.filter(mineM).sort(byNumber).map(workspace => ({
    workspace,
    tabs: tabs.filter(t => t.workspace === workspace.id).sort(byNumber).map(t => entryOf(t, s.panes)),
  })).filter(w => w.tabs.some(t => t.panes.length))
}

export function tabEntry(s: State, tabId: string): TabEntry | null {
  const tab = tabsOf(s).find(t => t.id === tabId)
  return tab ? entryOf(tab, s.panes) : null
}

// Compteurs d'état d'un onglet (agents seulement ; `done` = prêt non lu).
export function tabSummary(panes: Pane[]) {
  const n = (st: string) => panes.filter(p => p.agent && p.status === st).length
  return { blocked: n('blocked'), working: n('working'), done: n('done'), agents: panes.filter(p => p.agent).length }
}
