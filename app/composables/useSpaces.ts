// Actions on spaces, tabs and panes ("…" menus of the list by space, of a
// tab's plan and of the agent view). herdr-core keeps spaces and tabs in
// herdr-app's layout document, which wherdr does not write: a new tab (a new
// terminal in the space) is all there is; a pane is renamed (/api/rename) and
// closed (/api/close) on its own.
import type { Pane } from '#shared/types'
import { leadPane } from '#shared/spaces'
import { sameTabBody } from '#shared/coreTabMap'
import { HERDR_AGENT_KINDS } from '#shared/launchableAgents'
import { herdrPaneId, paneIdLine } from '~/utils/paneId'

// "New tab" in this space: the "New agent" sheet only creates it on "Launch".
export const newTabSpace = ref<string | null>(null)

// New tab: "+" starts a terminal like the space's current one, no sheet; the
// sheet opens when there is nothing to copy.
export function newTab(workspaceId: string) {
  haptic()
  const lead = leadPane(spaceTabs(workspaceId).flatMap(e => e.panes))
  const body = sameTabBody(lead || undefined, [...HERDR_AGENT_KINDS])
  if (body) return void quickTab(body)
  newTabChoose(workspaceId)
}
async function quickTab(body: Record<string, unknown>) {
  try {
    const r = await api<{ pane_id: string }>('/api/agents', body)
    toast(t('Tab created'))
    navigateTo(panePath(r.pane_id))
  }
  catch (err) { toast((err as Error).message, true) }
}
// New tab with a choice of kind and folder (the sheet).
export function newTabChoose(workspaceId: string) {
  haptic()
  newTabSpace.value = workspaceId
  newAgentOpen.value = true
}

// Menu entries.
export const newTabItem = (workspaceId: string): MenuItem => ({ label: t('New tab'), icon: 'i-lucide-plus', run: () => newTab(workspaceId) })
// Copy the pane's Herdr ID (its machine's, without the wherdr prefix).
export function copyPaneIdItem(p: Pane): MenuItem {
  const id = herdrPaneId(p.id)
  return {
    label: t('Copy pane ID'), icon: 'i-lucide-copy', mono: true,
    desc: paneIdLine(p.id, machineName(p.machine)),
    run: async () => {
      try {
        await navigator.clipboard.writeText(id)
        toast(`${t('Copied')} : ${id}`)
      } catch { toast(t('Copy failed'), true) }
    },
  }
}
export function tabItems(tabId: string): MenuItem[] {
  const e = tabOf(tabId)
  if (!e) return []
  return [newTabItem(e.tab.workspace), { label: t('New tab…'), icon: 'i-lucide-folder-plus', run: () => newTabChoose(e.tab.workspace) }]
}
// Close a pane: stops its agent, or closes its terminal.
export function closePaneItem(p: Pane, kbds?: string[]): MenuItem {
  return {
    label: p.agent ? tl(`Close this pane (stops ${kindLabel(p.agent)})`, `Fermer ce pane (arrête ${kindLabel(p.agent)})`) : t('Close this terminal'),
    icon: 'i-lucide-trash-2', danger: true, kbds, run: () => closePane(p),
  }
}
// Phone pane sheet (the header identity): everything that manages the pane
// being viewed, then its tab. The Options menu keeps the agent's own actions.
export function currentPaneItems(p: Pane): MenuItem[] {
  return [
    { label: t('Rename pane'), icon: 'i-lucide-pencil', run: () => { renameTarget.value = p.id } },
    copyPaneIdItem(p),
    // Conversation or its terminal view: the same pane, only this one.
    { ...closePaneItem(p), label: p.agent ? t('Close this conversation') : t('Close this terminal') },
  ]
}
// No "Close tab" here: a tab closes from its overview, where its panes show.
export function currentTabItems(tabId: string, overview?: MenuItem): MenuItem[] {
  const e = tabOf(tabId)
  if (!e) return []
  return [newTabItem(e.tab.workspace), ...(overview ? [overview] : [])]
}
export function workspaceItems(id: string): MenuItem[] {
  return [newTabItem(id)]
}
// Space of a pane (agent view, long press on its card): "Space" group, new tab.
export function paneWorkspaceItems(p: Pane): MenuItem[] {
  const ws = herdrState.value.workspaces.find(w => w.id === p.workspace)
  if (!ws) return []
  return [{ kind: 'group', label: tl(`Space “${ws.label}”`, `Espace « ${ws.label} »`) }, newTabItem(ws.id)]
}

// Full menu of a plan pane: rename, close.
export function paneItems(p: Pane): MenuItem[] {
  return [
    notificationMenuItem(p),
    { label: t('Rename pane'), icon: 'i-lucide-pencil', run: () => { renameTarget.value = p.id } },
    { kind: 'separator' },
    closePaneItem(p),
  ]
}
// Menu of a tab's plan: the tab, then its space.
export function tabPlanItems(tabId: string): MenuItem[] {
  const e = tabOf(tabId)
  if (!e) return []
  const ws = herdrState.value.workspaces.find(w => w.id === e.tab.workspace)
  return [
    { kind: 'group', label: t('Tab') },
    ...tabItems(tabId),
    { kind: 'group', label: ws ? tl(`Space “${ws.label}”`, `Espace « ${ws.label} »`) : t('Space') },
  ]
}
