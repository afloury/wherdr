// Espaces de travail : ouverture d'un space depuis la liste (onglet mémorisé),
// onglets en haut d'un space, plan d'un onglet (téléphone), vue côte à côte
// (ordinateur), balayage entre les panes d'un onglet.
import { tabEntry, workspaceTree } from '#shared/workspaces'
import { type Closing, type Landing, type TabMemory, type Viewed, afterClose, neighborTab, rememberTab, spaceTab } from '#shared/spaces'

// Dernier onglet ouvert de chaque space, gardé sur l'appareil.
const tabMemory = ref<TabMemory>({})
if (import.meta.client) {
  try { tabMemory.value = JSON.parse(localStorage.getItem('spaceTabs') || '{}') || {} }
  catch { /* stockage indisponible */ }
}
function saveMemory(m: TabMemory) {
  tabMemory.value = m
  try { localStorage.setItem('spaceTabs', JSON.stringify(m)) }
  catch { /* stockage indisponible */ }
}
// Onglet regardé (vue d'onglet, ou pane seul dans son onglet) : mémorisé pour son space.
export function noteTab(tabId: string) {
  const e = tabOf(tabId)
  if (!e || tabMemory.value[e.tab.workspace] === tabId) return
  const open = herdrState.value.ok ? herdrState.value.workspaces.map(w => w.id) : undefined
  saveMemory(rememberTab(tabMemory.value, e.tab.workspace, tabId, open))
}
// Onglet tout juste créé (pas encore dans l'état de Herdr) : mémorisé d'office.
export function rememberNewTab(workspaceId: string, tabId: string) {
  saveMemory(rememberTab(tabMemory.value, workspaceId, tabId))
}

// Panes tout juste fermés depuis l'app, cachés jusqu'à ce que l'état de Herdr
// les retire (un onglet dont tous les panes sont partis disparaît avec eux) :
// pas d'onglet ni de case fantôme entre la fermeture et l'état suivant.
const gone = shallowRef<Set<string>>(new Set())
watch(herdrState, (s) => {
  if (!gone.value.size) return
  const ids = new Set(s.panes.map(p => p.id))
  const keep = [...gone.value].filter(id => ids.has(id))
  if (keep.length !== gone.value.size) gone.value = new Set(keep)
})
const liveState = computed(() => {
  const s = herdrState.value
  return gone.value.size ? { ...s, panes: s.panes.filter(p => !gone.value.has(p.id)) } : s
})

// Onglets d'un space (ceux qui ont des panes), dans l'ordre de Herdr.
export function spaceTabs(workspaceId: string) {
  const ws = liveState.value.workspaces.find(w => w.id === workspaceId)
  if (!ws) return []
  return workspaceTree(liveState.value, ws.machine || '').find(w => w.workspace.id === workspaceId)?.tabs.filter(e => e.panes.length) || []
}

// Sens du dernier balayage (+1 suivant, -1 précédent) : le pane qui arrive glisse
// depuis ce côté-là.
export const swipeDir = ref<0 | 1 | -1>(0)

export const tabOf = (tabId: string | null | undefined) => (tabId ? tabEntry(liveState.value, tabId) : null)

export const tabPath = (tabId: string) => `/t/${encodeURIComponent(tabId)}`
export const panePath = (paneId: string) => `/a/${encodeURIComponent(paneId)}`

// Chemin d'un onglet : un seul pane, directement ce pane ; sinon son plan
// (téléphone) ou ses panes côte à côte (ordinateur).
export function tabTarget(tabId: string) {
  const e = tabOf(tabId)
  return e && e.panes.length === 1 ? panePath(e.panes[0]!.id) : tabPath(tabId)
}
export function openTab(tabId: string) {
  haptic()
  return navigateTo(tabTarget(tabId))
}
// Ouvrir un space depuis la liste : son dernier onglet, sinon celui de son
// pane le plus urgent.
export function openSpace(workspaceId: string) {
  const tab = spaceTab(spaceTabs(workspaceId), tabMemory.value, workspaceId)
  if (tab) return openTab(tab)
}
// Changer d'onglet dans un space (onglets en haut) : même entrée d'historique.
export function switchSpaceTab(tabId: string) {
  haptic()
  noteTab(tabId)
  return navigateTo(tabTarget(tabId), { replace: true })
}

// Revenir au plan de l'onglet : un retour arrière si on en vient (le balayage
// remplace l'entrée d'historique), sinon on y va.
export function backToTab(tabId: string) {
  haptic()
  const back = (history.state as { back?: string } | null)?.back
  if (back === tabPath(tabId)) return useRouter().back()
  return navigateTo(tabPath(tabId))
}

// ------------------------------------------------------------ fermeture
// Panes et onglets en cours de fermeture depuis l'app : leur vue n'affiche pas
// « fermé » pendant qu'elle cède la place à la destination.
const closingIds = shallowRef<Set<string>>(new Set())
export const isClosing = (id: string) => closingIds.value.has(id)
// Vue ouverte (onglet ou pane), sinon null.
function viewedNow(): Viewed | null {
  const route = useRouter().currentRoute.value
  if (route.path.startsWith('/t/')) return { tab: String(route.params.tab || '') }
  if (route.path.startsWith('/a/')) return { pane: String(route.params.pane || '') }
  return null
}
// Aller à la destination d'une fermeture : un retour arrière si on en vient,
// sinon à la place de la vue fermée (pas d'entrée morte dans l'historique).
function land(l: Landing) {
  if (!l) return
  const path = l === 'home' ? '/' : 'tab' in l ? tabPath(l.tab) : panePath(l.pane)
  const back = (history.state as { back?: string } | null)?.back
  if (back === path) return useRouter().back()
  return navigateTo(path, { replace: true })
}
// Fermeture confirmée, avant l'appel à Herdr : destination décidée sur l'état
// connu (fermer un onglet montre son voisin, comme Herdr ; la liste seulement
// quand le space n'a plus rien). Renvoie la suite, appelée avec le résultat de
// l'appel : réussi, cacher ce qui part, mémoriser l'onglet voisin, y aller.
export function prepareClose(closing: Closing) {
  const s = liveState.value
  const landing = afterClose(s, closing, viewedNow())
  const panes = s.panes.filter(p => ('tab' in closing ? p.tab === closing.tab : 'pane' in closing ? p.id === closing.pane : p.workspace === closing.workspace))
  // Onglet qui disparaît (fermé, ou son dernier pane) : son voisin devient
  // l'onglet mémorisé du space s'il l'était.
  const p0 = panes[0]
  const tab = 'tab' in closing ? closing.tab : 'pane' in closing && p0 && s.panes.filter(p => p.tab === p0.tab).length === 1 ? p0.tab : null
  const ws = p0?.workspace
  const next = tab ? neighborTab(s, tab) : null
  const ids = [...panes.map(p => p.id), ...new Set(panes.map(p => p.tab))]
  closingIds.value = new Set([...closingIds.value, ...ids])
  const release = () => { closingIds.value = new Set([...closingIds.value].filter(id => !ids.includes(id))) }
  return (ok: boolean) => {
    // La vue fermée a le temps de partir avant d'annoncer « fermé ».
    if (!ok) return release()
    setTimeout(release, 1500)
    gone.value = new Set([...gone.value, ...panes.map(p => p.id)])
    if (tab && next && ws && tabMemory.value[ws] === tab) saveMemory(rememberTab(tabMemory.value, ws, next))
    land(landing)
  }
}
