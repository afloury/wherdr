// Actions sur les espaces, onglets et panes (menus « … » de la liste par
// espace, du plan d'un onglet et de la vue agent) : nouvel onglet, diviser,
// renommer, fermer, déplacer, glisser-déposer, redimensionner. Toujours sur un
// geste explicite ; jamais de zoom (la disposition est partagée avec le client attaché).
import type { Pane } from '#shared/types'
import { type MoveDestination, type SpaceEntry, type SplitDirection, moveTargets, paneSpaceEntries } from '#shared/spaceActions'
import { reorderWorkspaces } from '#shared/spaces'
import { type DropSide, type PaneDirection, type TabLayout, directionNeighbor, dropPreview, layoutTree, resizePreview, swapDirections, swapInLayout } from '#shared/layout'
import { closeConfirm } from '~/utils/spaceConfirm'
import { herdrPaneId, paneIdLine } from '~/utils/paneId'

// Renommer un espace ou un onglet (le pane garde `renameTarget`).
export const renameSpace = ref<{ kind: 'workspace' | 'tab', id: string, label: string } | null>(null)
// « Nouvel onglet » dans cet espace, ou « Diviser » ce pane dans ce sens : la
// feuille « Nouvel agent » crée l'onglet ou le pane seulement sur « Lancer ».
export const newTabSpace = ref<string | null>(null)
export const newSplit = ref<{ paneId: string, direction: SplitDirection } | null>(null)

interface SpaceReply { ok: boolean, pane_id?: string, tab_id?: string }
async function spaceApi(body: Record<string, unknown>): Promise<SpaceReply | null> {
  haptic()
  try { return await api<SpaceReply>('/api/space', body) }
  catch (err) {
    toast((err as Error).message, true)
    return null
  }
}

// Nouvel onglet : la feuille « Nouvel agent » s'ouvre d'abord, rien n'est
// créé ; l'onglet naît au clic sur « Lancer » (NewAgentSheet), la fermer
// n'a laissé aucune trace dans Herdr.
export function newTab(workspaceId: string) {
  haptic()
  newSplit.value = null
  newTabSpace.value = workspaceId
  newAgentOpen.value = true
}
// Diviser : même principe, le pane naît au clic sur « Lancer ».
export function splitPane(p: Pane, direction: SplitDirection) {
  haptic()
  newTabSpace.value = null
  newSplit.value = { paneId: p.id, direction }
  newAgentOpen.value = true
}

export function renameWorkspace(id: string) {
  const w = herdrState.value.workspaces.find(x => x.id === id)
  if (w) renameSpace.value = { kind: 'workspace', id, label: w.label }
}
export function renameTab(id: string) {
  const e = tabOf(id)
  if (e) renameSpace.value = { kind: 'tab', id, label: e.tab.label }
}
export async function saveSpaceName(label: string) {
  const x = renameSpace.value
  if (!x) return
  const r = await spaceApi(x.kind === 'tab' ? { op: 'tab.rename', tab_id: x.id, label } : { op: 'workspace.rename', workspace_id: x.id, label })
  if (!r) return
  renameSpace.value = null
  toast(t('Renamed'))
}

export async function closeTab(id: string) {
  const e = tabOf(id)
  if (!e) return
  const ws = herdrState.value.workspaces.find(w => w.id === e.tab.workspace)
  const siblings = (herdrState.value.tabs || []).filter(x => x.workspace === e.tab.workspace)
  const c = closeConfirm({
    kind: 'tab', label: e.tab.label || String(e.tab.number), panes: e.panes,
    lastTab: siblings.length <= 1, workspaceLabel: ws?.label,
  }, tl)
  const plan = await confirmClose('tab', id, c.message, c.action)
  if (!plan) return
  const done = prepareClose(plan.group ? { workspace: e.tab.workspace } : { tab: id }, plan.group ? plan.workspaces.map(w => w.id) : [])
  if (!(await spaceApi({ op: 'tab.close', tab_id: id, close_group: plan.group }))) return done(false)
  toast(plan.group ? tl('Group closed', 'Groupe fermé') : t('Tab closed'))
  done(true)
}

export async function closeWorkspace(id: string) {
  const w = herdrState.value.workspaces.find(x => x.id === id)
  if (!w) return
  const panes = herdrState.value.panes.filter(p => p.workspace === id)
  const c = closeConfirm({ kind: 'workspace', label: w.label, panes }, tl)
  const plan = await confirmClose('workspace', id, c.message, c.action)
  if (!plan) return
  const done = prepareClose({ workspace: id }, plan.group ? plan.workspaces.map(w => w.id) : [])
  if (!(await spaceApi({ op: 'workspace.close', workspace_id: id, close_group: plan.group }))) return done(false)
  toast(plan.group ? tl('Group closed', 'Groupe fermé') : t('Space closed'))
  done(true)
}

// Déplacer un pane : menu des destinations (onglets de sa machine, nouvel
// onglet de son espace, nouvel espace). La vue qui le montrait le suit.
export function movePane(p: Pane) {
  const targets = moveTargets(herdrState.value, p.id)
  const go = (to: MoveDestination) => () => doMove(p, to)
  const items: MenuItem[] = [
    { label: t('New tab'), icon: 'i-lucide-plus', desc: t('in the same space'), run: go('new_tab') },
    { label: t('New space'), icon: 'i-lucide-square-plus', run: go('new_workspace') },
  ]
  let ws: string | null = null
  for (const x of targets) {
    if (x.workspace !== ws) {
      ws = x.workspace
      items.push({ kind: 'group', label: x.sameWorkspace ? t('This space') : x.workspaceLabel })
    }
    items.push({
      label: `${t('Tab')} ${x.label}`, icon: 'i-lucide-panels-top-left',
      desc: tl(`${x.panes} pane${x.panes > 1 ? 's' : ''}`, `${x.panes} pane${x.panes > 1 ? 's' : ''}`),
      run: go({ tab_id: x.tab_id }),
    })
  }
  openMenu(items, tl(`Move “${paneTitle(p)}”`, `Déplacer « ${paneTitle(p)} »`))
}
async function doMove(p: Pane, to: MoveDestination) {
  const r = await spaceApi({ op: 'pane.move', pane_id: p.id, to })
  if (!r) return
  toast(t('Pane moved'))
  // Déplacé vers un autre espace, le pane change d'ID : la vue le suit.
  const route = useRouter().currentRoute.value
  if (r.pane_id && r.pane_id !== p.id && route.path === panePath(p.id)) navigateTo(panePath(r.pane_id), { replace: true })
}

// Échanger un pane avec son voisin (Ctrl+B puis Shift+H/J/K/L dans Herdr) :
// seulement les directions où il y en a un, d'après la vraie disposition.
// Le pane garde son ID : la case active et la vue le suivent d'elles-mêmes.
export function paneSwapDirections(p: Pane): PaneDirection[] {
  const e = tabOf(p.tab)
  // Disposition reconstituée (pas celle de Herdr) : pas de voisins fiables.
  if (!e || e.layout !== e.tab.layout) return []
  return swapDirections(e.layout, p.id)
}
export async function swapPane(p: Pane, direction: PaneDirection) {
  const e = tabOf(p.tab)
  const other = e ? directionNeighbor(e.layout, p.id, direction) : null
  const tabs = herdrState.value.tabs
  // Nouvelle disposition affichée tout de suite ; l'état suivant la confirme.
  if (tabs && other) herdrState.value = { ...herdrState.value, tabs: tabs.map(x => (x.id === p.tab && x.layout ? { ...x, layout: swapInLayout(x.layout, p.id, other) } : x)) }
  const r = await spaceApi({ op: 'pane.swap', pane_id: p.id, direction })
  if (!r) {
    if (herdrState.value.tabs !== tabs && tabs) herdrState.value = { ...herdrState.value, tabs }
    return
  }
  // Plan ou côte à côte de son onglet : la case déplacée devient la case active.
  const router = useRouter()
  if (router.currentRoute.value.path === tabPath(p.tab)) router.replace({ query: { pane: p.id } })
}
// Disposition d'un onglet montrée tout de suite (glisser-déposer, trait
// glissé), avant la confirmation de Herdr ; l'ancienne revient si l'appel
// échoue et qu'aucun état plus récent n'est arrivé entre-temps.
async function withLayout(tabId: string, next: TabLayout, body: Record<string, unknown>) {
  const tabs = herdrState.value.tabs
  const mine = tabs?.map(x => (x.id === tabId && x.layout ? { ...x, layout: next } : x))
  if (mine) herdrState.value = { ...herdrState.value, tabs: mine }
  const r = await spaceApi(body)
  if (!r && tabs && herdrState.value.tabs === mine) herdrState.value = { ...herdrState.value, tabs }
  return r
}
// Glisser-déposer possible : vraie disposition de Herdr, arbre lisible, pas agrandi.
export function tabDraggable(tabId: string): boolean {
  const e = tabOf(tabId)
  return Boolean(e && e.layout === e.tab.layout && !e.layout.zoomed && e.panes.length > 1 && layoutTree(e.layout))
}
// Déposer `p` sur `target` (même onglet) : centre = échanger, bord = placer à côté.
export async function dropPane(p: Pane, target: string, side: DropSide) {
  const e = tabOf(p.tab)
  const next = e ? dropPreview(e.layout, p.id, target, side) : null
  if (!e || !next) return
  if (!(await withLayout(p.tab, next, { op: 'pane.drop', pane_id: p.id, target_pane_id: target, side }))) return
  const router = useRouter()
  if (router.currentRoute.value.path === tabPath(p.tab)) router.replace({ query: { pane: p.id } })
}
// Trait de séparation relâché : un seul appel, avec le ratio final.
export async function resizeSplit(tabId: string, path: string, ratio: number) {
  const e = tabOf(tabId)
  if (!e) return
  await withLayout(tabId, resizePreview(e.layout, path, ratio), { op: 'layout.ratio', tab_id: tabId, path, ratio })
}
const SWAP: Record<PaneDirection, { label: string, icon: string, key: string, arrow: string }> = {
  left: { label: 'Swap with the pane on the left', icon: 'i-lucide-arrow-left', key: 'H', arrow: 'arrowleft' },
  right: { label: 'Swap with the pane on the right', icon: 'i-lucide-arrow-right', key: 'L', arrow: 'arrowright' },
  up: { label: 'Swap with the pane above', icon: 'i-lucide-arrow-up', key: 'K', arrow: 'arrowup' },
  down: { label: 'Swap with the pane below', icon: 'i-lucide-arrow-down', key: 'J', arrow: 'arrowdown' },
}
export const paneSwapItems = (p: Pane): MenuItem[] => paneSwapDirections(p).map(d => ({
  label: t(SWAP[d].label), icon: SWAP[d].icon, kbds: ['alt', 'shift', SWAP[d].arrow], run: () => swapPane(p, d),
}))
// Raccourci (ordinateur) : Alt+Maj+flèche ou Alt+Maj+H/J/K/L, sur le pane
// regardé, jamais pendant une saisie (champ, terminal) : ces touches y
// sélectionnent du texte ou partent au programme.
const SWAP_CODES: Record<string, PaneDirection> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyH: 'left', KeyL: 'right', KeyK: 'up', KeyJ: 'down',
}
export function swapShortcut(e: KeyboardEvent): boolean {
  const d = SWAP_CODES[e.code]
  if (!d || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || !desk.value) return false
  const el = e.target as HTMLElement | null
  if (el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm, [role="dialog"], [role="menu"]')) return false
  const p = herdrState.value.panes.find(x => x.id === curPane.value)
  if (!p || !paneSwapDirections(p).includes(d)) return false
  e.preventDefault()
  swapPane(p, d)
  return true
}

// Entrées des menus.
export const newTabItem = (workspaceId: string): MenuItem => ({ label: t('New tab'), icon: 'i-lucide-plus', run: () => newTab(workspaceId) })
// Copier l'ID Herdr du pane (celui de sa machine, sans préfixe wherdr).
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
export function paneSpaceItems(p: Pane): MenuItem[] {
  return [
    { label: t('Split right'), icon: 'i-lucide-columns-2', run: () => splitPane(p, 'right') },
    { label: t('Split down'), icon: 'i-lucide-rows-2', run: () => splitPane(p, 'down') },
    { label: t('Move to…'), icon: 'i-lucide-move', run: () => movePane(p) },
    ...paneSwapItems(p),
  ]
}
export function tabItems(tabId: string): MenuItem[] {
  const e = tabOf(tabId)
  if (!e) return []
  return [
    { label: t('Rename tab'), icon: 'i-lucide-pencil', run: () => renameTab(tabId) },
    newTabItem(e.tab.workspace),
    { label: t('Close tab'), icon: 'i-lucide-x', danger: true, run: () => closeTab(tabId) },
  ]
}
export function workspaceItems(id: string): MenuItem[] {
  return [
    { label: t('Rename space'), icon: 'i-lucide-pencil', run: () => renameWorkspace(id) },
    newTabItem(id),
    { label: t('Close space'), icon: 'i-lucide-trash-2', danger: true, run: () => closeWorkspace(id) },
  ]
}
// Espace et onglet d'un pane (vue agent, appui long de sa carte) : groupe
// « Espace », nouvel onglet en tête.
export function paneWorkspaceItems(p: Pane): MenuItem[] {
  const ws = herdrState.value.workspaces.find(w => w.id === p.workspace)
  const entries = paneSpaceEntries(herdrState.value, p.id)
  if (!ws || !entries.length) return []
  const item: Record<SpaceEntry, MenuItem> = {
    'tab.create': newTabItem(ws.id),
    'tab.rename': { label: t('Rename tab'), icon: 'i-lucide-pencil', run: () => renameTab(p.tab) },
    'tab.close': { label: t('Close tab'), icon: 'i-lucide-x', danger: true, run: () => closeTab(p.tab) },
    'workspace.rename': { label: t('Rename space'), icon: 'i-lucide-pencil', run: () => renameWorkspace(ws.id) },
    'workspace.close': { label: t('Close space'), icon: 'i-lucide-trash-2', danger: true, run: () => closeWorkspace(ws.id) },
  }
  return [{ kind: 'group', label: tl(`Space “${ws.label}”`, `Espace « ${ws.label} »`) }, ...entries.map(e => item[e])]
}

// Menu complet d'un pane du plan : renommer, diviser, déplacer, fermer.
export function paneItems(p: Pane): MenuItem[] {
  return [
    { label: t('Rename pane'), icon: 'i-lucide-pencil', run: () => { renameTarget.value = p.id } },
    ...paneSpaceItems(p),
    { kind: 'separator' },
    {
      label: p.agent ? tl(`Close this pane (stops ${kindLabel(p.agent)})`, `Fermer ce pane (arrête ${kindLabel(p.agent)})`) : t('Close this terminal'),
      icon: 'i-lucide-trash-2', danger: true, run: () => closePane(p),
    },
  ]
}
// Menu du plan d'un onglet : l'onglet, puis son espace.
export function tabPlanItems(tabId: string): MenuItem[] {
  const e = tabOf(tabId)
  if (!e) return []
  const ws = herdrState.value.workspaces.find(w => w.id === e.tab.workspace)
  return [
    { kind: 'group', label: t('Tab') },
    ...tabItems(tabId),
    { kind: 'group', label: ws ? tl(`Space “${ws.label}”`, `Espace « ${ws.label} »`) : t('Space') },
    ...workspaceItems(e.tab.workspace).filter(x => x.label !== t('New tab')),
  ]
}

// Réordonner les espaces (glisser-déposer de la liste) : placé avant `before`
// (null : à la fin), sur la machine de l'espace. Nouvel ordre affiché tout de
// suite ; l'état suivant de Herdr le confirme (ou le défait si l'appel échoue).
export async function moveWorkspace(id: string, before: string | null) {
  const prev = herdrState.value.workspaces
  const next = reorderWorkspaces(prev, id, before)
  herdrState.value = { ...herdrState.value, workspaces: next }
  const r = await spaceApi({ op: 'workspace.move', workspace_id: id, before_workspace_id: before })
  // Échec, et pas d'état plus récent entre-temps : on remet l'ordre d'avant.
  if (!r && herdrState.value.workspaces === next) herdrState.value = { ...herdrState.value, workspaces: prev }
}
