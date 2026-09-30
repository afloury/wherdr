// État global de l'app : agents en direct (WebSocket /ws/events), réglages de
// l'appareil, verrouillage, appels d'API. Singletons de module (app cliente).
import type { AppConfig, AuthStatus, HerdrState, MachineConfig, MachineInfo, NamedSession, Pane, Quotas } from '#shared/types'
import { LOCAL, splitId } from '#shared/ids'
import { clearOffline, readOffline, saveHome } from '~/utils/offlineCache'
import { mayReadOffline, readOfflineAccess, setOfflineAccess } from '~/utils/offlineAccess'
import { activeTerminalRenderer, parseTerminalRenderer } from '~/utils/terminalRenderer'
import type { ActiveTerminalRenderer } from '~/utils/terminalRenderer'
import { settleState } from '#shared/stateReady'
import { readSessionSelection, selectSessions, writeSessionSelection } from '~/utils/sessionSelection'
import { effectiveTypingSpeed, encryptedTextActive, parseTypingSettings } from '~/utils/typewriter'
import { readHiddenAgents } from '~/utils/agentChoices'
import { migrateContentWidth } from '~/utils/contentWidth'
import { readQuotaDisplay } from '~/utils/quotas'
import { readShowShells } from '~/utils/terminalVisibility'
import type { QuotaDisplay } from '~/utils/quotas'
import type { ContentWidth } from '~/utils/contentWidth'

const ls = {
  get(k: string) {
    try { return localStorage.getItem(k) }
    catch { return null }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v) }
    catch { /* stockage indisponible */ }
  },
}

export const herdrState = shallowRef<HerdrState>({ ok: false, workspaces: [], panes: [] })
let fullState: HerdrState = herdrState.value
function loadSessionNames(): Record<string, string> {
  return readSessionSelection(ls.get('machineSessions'))
}
export const machineSessions = ref<Record<string, string>>(loadSessionNames())
function setSessionNames(names: Record<string, string>) {
  machineSessions.value = names
  ls.set('machineSessions', writeSessionSelection(names))
  herdrState.value = selectSessions(fullState, names)
}
export async function listMachineSessions(baseKey: string): Promise<NamedSession[]> {
  return (await api<{ sessions: NamedSession[] }>(`/api/sessions?machine=${encodeURIComponent(baseKey)}`)).sessions
}
export async function chooseMachineSession(baseKey: string, name: string) {
  const chosen = await api<{ session: NamedSession }>('/api/sessions', { machine: baseKey, name })
  setSessionNames({ ...machineSessions.value, [baseKey]: name })
  lastMachine.value = chosen.session.key
  syncPushLanguage().catch(() => {})
  await loadConfig()
}
const sessionTries = new Map<string, number>()
async function restoreMachineSessions() {
  for (const [baseKey, name] of Object.entries(machineSessions.value)) {
    if (!name || fullState.machines?.some(m => m.key === baseKey && m.session === name)) continue
    if (fullState.machines?.some(m => m.baseKey === baseKey && m.session === name)) continue
    const now = Date.now()
    if (now - (sessionTries.get(baseKey) || 0) < 10000) continue
    sessionTries.set(baseKey, now)
    api('/api/sessions', { machine: baseKey, name }).catch(() => {})
  }
}
async function checkSelectedSessions() {
  for (const [baseKey, name] of Object.entries(machineSessions.value)) {
    if (!name || fullState.machines?.some(m => m.key === baseKey && m.session === name)) continue
    try {
      const rows = await listMachineSessions(baseKey)
      if (!rows.some(s => s.name === name && s.running)) {
        const next = { ...machineSessions.value }
        delete next[baseKey]
        setSessionNames(next)
        syncPushLanguage().catch(() => {})
        if (lastMachine.value && !fullState.machines?.some(m => m.key === lastMachine.value && !m.baseKey)) lastMachine.value = baseKey
        toast(t('Session indisponible : retour à la session par défaut'))
      }
    } catch { /* machine momentanément inaccessible */ }
  }
}
export const eventsOpen = ref(false)
export const netDown = ref(false)
export const cachedAt = ref<number | null>(null)
export const offlineView = computed(() => cachedAt.value !== null)
export const locked = ref(false)
export const appConfig = ref<AppConfig>({ kinds: ['claude', 'codex'], home: '', dirs: [], push: { enabled: false, key: null, devices: 0 } })
// Nom de la machine (HOST_LABEL côté serveur) : « <nom> · herdr », sinon « herdr ».
export const hostLabel = ref('')
export const brandLabel = computed(() => 'wherdr')
export const curPane = ref<string | null>(null)
export const pageVisible = ref(true)

// Réglages de l'appareil.
export const showShells = ref(readShowShells(ls.get('showShells')))
watch(showShells, v => ls.set('showShells', v ? '1' : '0'))
export const showCounters = ref(ls.get('showCounters') !== '0')
watch(showCounters, v => ls.set('showCounters', v ? '1' : '0'))
export const showQuotas = ref(ls.get('showQuotas') !== '0')
watch(showQuotas, v => ls.set('showQuotas', v ? '1' : '0'))
export const autoReorderReady = ref(ls.get('autoReorderReady') !== '0')
watch(autoReorderReady, v => ls.set('autoReorderReady', v ? '1' : '0'))
// Panneau Projet : masquer les listes sans élément (réglage propre à l'appareil).
export const projectHideEmpty = ref(ls.get('projectHideEmpty') === '1')
watch(projectHideEmpty, v => ls.set('projectHideEmpty', v ? '1' : '0'))
export const quotaDisplay = ref<QuotaDisplay>(readQuotaDisplay(ls.get('quotaDisplay')))
watch(quotaDisplay, v => ls.set('quotaDisplay', v))
export const hiddenAgents = ref<string[]>(readHiddenAgents(ls.get('hiddenAgents')))
watch(hiddenAgents, v => ls.set('hiddenAgents', JSON.stringify(v)))
// Largeur du contenu sur ordinateur ; migration de l'ancienne préférence.
export const contentWidth = ref<ContentWidth>(migrateContentWidth(ls.get('contentWidth'), ls.get('chatWidth')))
watch(contentWidth, (v) => {
  ls.set('contentWidth', v)
  if (import.meta.client) {
    try { localStorage.removeItem('chatWidth') } catch { /* stockage indisponible */ }
    document.documentElement.dataset.contentWidth = v
  }
}, { immediate: true })
// Réglages indépendants ; migration des anciens modes à la première lecture.
const savedTyping = parseTypingSettings(ls.get('typewriterSpeed'), ls.get('encryptedText'), ls.get('typewriterMode'), ls.get('typewriter'))
// Inscrit les nouvelles clés dès la migration pour ne plus dépendre des
// anciennes valeurs lors des prochains lancements.
if (import.meta.client) {
  ls.set('typewriterSpeed', savedTyping.speed)
  ls.set('encryptedText', savedTyping.encrypted ? '1' : '0')
}
export const typewriterSpeed = ref(savedTyping.speed)
export const encryptedText = ref(savedTyping.encrypted)
watch(typewriterSpeed, v => ls.set('typewriterSpeed', v))
watch(encryptedText, v => ls.set('encryptedText', v ? '1' : '0'))
export const reducedMotion = ref(false)
if (import.meta.client) {
  const mq = matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = mq.matches
  mq.addEventListener('change', (e) => { reducedMotion.value = e.matches })
}
export const typingSpeed = computed(() => effectiveTypingSpeed(typewriterSpeed.value, reducedMotion.value))
export const typewriterActive = computed(() => typingSpeed.value !== 'off')
export const encryptedActive = computed(() => encryptedTextActive(typewriterSpeed.value, encryptedText.value, reducedMotion.value))
// Quotas des comptes (lus par QuotaStrip, aussi montrés dans les en-têtes de machine).
export const homeQuotas = ref<Quotas | null>(null)
export const fontSize = ref(Number(ls.get('fontSize')) || 12)
watch(fontSize, v => ls.set('fontSize', String(v)))
export const terminalRenderer = ref(parseTerminalRenderer(ls.get('terminalRenderer')))
watch(terminalRenderer, v => ls.set('terminalRenderer', v))
// Le moteur réellement chargé dans xterm ; conservé après fermeture de la vue
// terminal pour que Réglages puisse montrer le dernier résultat observé.
export const terminalRenderStatus = ref<ActiveTerminalRenderer | null>(null)
const webglAvailable = ref<boolean | null>(null)
export function reportTerminalRenderer(active: ActiveTerminalRenderer) {
  terminalRenderStatus.value = active
  if (active !== 'html') webglAvailable.value = active === 'webgl'
}
export function refreshTerminalRenderStatus() {
  if (terminalRenderer.value === 'html') {
    terminalRenderStatus.value = 'html'
    return
  }
  if (webglAvailable.value === null && import.meta.client) {
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2')
      webglAvailable.value = Boolean(gl)
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch { webglAvailable.value = false }
  }
  terminalRenderStatus.value = activeTerminalRenderer(terminalRenderer.value, webglAvailable.value === true)
}
if (import.meta.client) {
  window.addEventListener('storage', (event) => {
    if (event.key === 'terminalRenderer') {
      terminalRenderer.value = parseTerminalRenderer(event.newValue)
      refreshTerminalRenderStatus()
    }
  })
}
// Onglet retenu par pane : chaque conversation garde le sien.
// Conversation est le défaut ; Terminal et Projet (coordinateur) sont mémorisés.
export type PaneViewMode = 'chat' | 'term' | 'project'
function loadViewModes(): Record<string, 'term' | 'project'> {
  try {
    const v = JSON.parse(ls.get('viewModes') || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}
const viewModes = reactive(loadViewModes())
export const paneViewMode = (id: string): PaneViewMode =>
  (viewModes[id] === 'term' || viewModes[id] === 'project' ? viewModes[id] : 'chat')
export function setPaneViewMode(id: string, m: PaneViewMode) {
  if (m !== 'chat') viewModes[id] = m
  else delete viewModes[id]
  ls.set('viewModes', JSON.stringify(viewModes))
}
// Panes disparus : on oublie leur onglet, mais seulement pour les machines en
// ligne (une machine pas encore reconnectée n'a pas encore listé ses panes).
function pruneViewModes(s: HerdrState) {
  if (!s.ok) return
  const alive = new Set(fullState.panes.map(p => p.id))
  const online = new Set([LOCAL, ...(fullState.machines || []).filter(m => m.status === 'online').map(m => m.key)])
  let changed = false
  for (const id of Object.keys(viewModes)) {
    if (!alive.has(id) && online.has(splitId(id).machine)) { delete viewModes[id]; changed = true }
  }
  if (changed) ls.set('viewModes', JSON.stringify(viewModes))
}
watch(herdrState, pruneViewModes)
export const lastKind = ref(ls.get('lastKind') || '')
watch(lastKind, v => ls.set('lastKind', v))

// Ordinateur (≥ 900 px) : liste en barre latérale, agent à droite.
export const desk = ref(false)
if (import.meta.client) {
  const mq = matchMedia('(min-width: 900px)')
  desk.value = mq.matches
  mq.addEventListener('change', () => { desk.value = mq.matches })
}

export const currentPane = computed<Pane | undefined>(() => herdrState.value.panes.find(p => p.id === curPane.value))

// ---------------------------------------------------------------- machines
// Plusieurs machines (profils SSH de Herdr) : `machines` n'est envoyé que s'il
// y en a au moins deux ; avec une seule, l'app reste exactement comme avant.
export const machines = computed<MachineInfo[]>(() => herdrState.value.machines || [])
export const multiMachine = computed(() => machines.value.length > 1 || Boolean(machines.value[0]?.baseKey))
export const machineInfo = (key: string | null | undefined) => machines.value.find(m => m.key === (key || ''))
// Machines proposées par les feuilles « Nouvel agent » et « New project » (null
// avec une seule machine) ; en ligne d'après l'état en direct (la config a pu
// être lue avant la connexion).
export const machineChoices = computed(() => (multiMachine.value ? (appConfig.value.machines || []).filter(m => machines.value.some(s => s.key === m.key)) : null))
export const machineOnline = (m: MachineConfig) => m.local || (machineInfo(m.key)?.status === 'online' && Boolean(m.home))
export const machineStateOf = (m: MachineConfig) => (m.local ? 'online' : machineInfo(m.key)?.status || 'offline')
export const machineName = (key: string | null | undefined) => {
  const m = machineInfo(key)
  return m ? m.label || t('Cette machine') : ''
}
// Pane d'une machine injoignable : son dernier état, grisé.
export const paneStale = (p: Pane | null | undefined) => {
  const m = p ? machineInfo(p.machine) : undefined
  return Boolean(m && m.status !== 'online')
}
function readList(k: string): string[] {
  try {
    const v = JSON.parse(ls.get(k) || '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch { return [] }
}
// Sections de machine repliées (gardé sur l'appareil).
export const collapsedMachines = ref<string[]>(readList('collapsedMachines'))
watch(collapsedMachines, v => ls.set('collapsedMachines', JSON.stringify(v)))
// Projets herdr-projects repliés (« <machine>|<projet> », gardé sur l'appareil).
export const collapsedProjects = ref<string[]>(readList('collapsedProjects'))
watch(collapsedProjects, v => ls.set('collapsedProjects', JSON.stringify(v)))
// Dépôts repliés, par machine, projet et chemin de dépôt sur cet appareil.
export const collapsedRepos = ref<string[]>(readList('collapsedRepos'))
watch(collapsedRepos, v => ls.set('collapsedRepos', JSON.stringify(v)))
// Dernière machine choisie dans « Nouveau ».
export const lastMachine = ref(ls.get('lastMachine') || '')
watch(lastMachine, v => ls.set('lastMachine', v))

// ---------------------------------------------------------------- toasts
type Toaster = ReturnType<typeof useToast>
let toaster: Toaster | null = null
export function setToaster(t: Toaster) { toaster = t }
// `detail` : ligne de plus, en petit (sortie d'une action de plugin…).
export function clearToast() { toaster?.clear() }
export function toast(msg: string, err = false, detail?: string) {
  if (!toaster) return
  toaster.clear()
  toaster.add({
    title: msg,
    description: detail || undefined,
    color: err ? 'error' : 'neutral',
    class: err ? 'hw-toast-error' : undefined,
    icon: err ? 'i-lucide-circle-alert' : undefined,
    duration: (err ? 4200 : 2600) + (detail ? 2400 : 0),
    close: false,
  })
}

// ---------------------------------------------------------------- API
export class ApiError extends Error {
  code?: string
  status: number
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = body === undefined
    ? {}
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const r = await fetch(path, opts)
  const data = await r.json().catch(() => ({}))
  // Session expirée (12 h) ou app verrouillée : on repasse par la clé d'accès.
  if (r.status === 401 && data.code === 'locked' && !path.startsWith('/api/auth/')) showLock()
  // Erreurs de Herdr transmises telles quelles (en anglais) : message traduit par code.
  const known = data.code === 'agent_not_ready' ? 'L’agent n’est pas prêt dans ce pane (arrêté ou en cours de démarrage).' : null
  if (!r.ok) throw new ApiError(t(known || data.error || `HTTP ${r.status}`), r.status, data.code)
  return data as T
}

export async function loadConfig() {
  try {
    appConfig.value = await api<AppConfig>('/api/config')
    if (appConfig.value.hostLabel !== undefined) hostLabel.value = appConfig.value.hostLabel
  }
  catch { /* on garde la précédente */ }
}

// ---------------------------------------------------------------- état en direct
let evWs: WebSocket | null = null
let evRetry = 0
// Reconnexion après une coupure : le serveur a pu redémarrer (cf. settleState).
let everOpen = false
let settleUntil = 0
const SETTLE_MS = 30000
let lastStateAt: number | null = null
let evTimer: ReturnType<typeof setTimeout> | undefined
let netTimer: ReturnType<typeof setTimeout> | undefined
const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

// Bandeau « connexion perdue » : affiché si le serveur reste injoignable plus de
// 2,5 s (une reconnexion éclair ne clignote pas).
function setNetDown(down: boolean) {
  if (!down) {
    clearTimeout(netTimer)
    netTimer = undefined
    netDown.value = false
    return
  }
  // Déjà affiché ou en passe de l'être : les tentatives suivantes ne repoussent pas le délai.
  if (netDown.value || netTimer) return
  netTimer = setTimeout(() => {
    netTimer = undefined
    netDown.value = true
  }, 2500)
}

function normalize(s: HerdrState): HerdrState {
  // Une question à l'écran (ex. confiance du dossier chez Codex, que Herdr
  // voit « idle ») : pour l'utilisateur, l'agent attend sa réponse.
  // Idem pour un écran d'attente reconnu (hooks de Codex, connexion…).
  for (const p of s.panes) if (((p.prompt && p.prompt.options) || knownScreen(p)) && p.status !== 'working') p.status = 'blocked'
  return s
}

export function connectEvents() {
  clearTimeout(evTimer)
  if (locked.value) return
  if (evWs && evWs.readyState <= 1) return
  const ws = new WebSocket(`${wsBase()}/ws/events`)
  evWs = ws
  ws.onopen = () => {
    evRetry = 0
    eventsOpen.value = true
    if (everOpen) settleUntil = Date.now() + SETTLE_MS
    everOpen = true
    sendViewing()
    restoreMachineSessions()
  }
  ws.onmessage = (e) => {
    try {
      const got = normalize(JSON.parse(e.data)) as HerdrState
      // Serveur tout juste redémarré, état encore partiel : on garde tout
      // l'affichage, le bandeau « reconnexion » reste en place.
      const state = settleState(lastStateAt ? fullState : null, got, Date.now() < settleUntil)
      if (!state) return
      setNetDown(false)
      if (!state.ok && herdrState.value.ok && lastStateAt) {
        cachedAt.value = lastStateAt
        return
      }
      fullState = state
      herdrState.value = selectSessions(state, machineSessions.value)
      restoreMachineSessions()
      lastStateAt = Date.now()
      cachedAt.value = null
      if (state.ok && mayReadOffline(readOfflineAccess())) saveHome(herdrState.value)
    }
    catch { /* message illisible */ }
  }
  ws.onclose = () => {
    if (evWs !== ws) return
    evWs = null
    eventsOpen.value = false
    if (herdrState.value.ok && lastStateAt) cachedAt.value = lastStateAt
    // Refus pour cause de verrouillage (session expirée) plutôt que coupure réseau ?
    api<AuthStatus>('/api/auth/status').then((st) => {
      if (st.enabled && !st.unlocked) showLock()
    }).catch(() => {})
    if (locked.value) return
    setNetDown(true)
    evTimer = setTimeout(connectEvents, Math.min(8000, 500 * 2 ** evRetry++))
  }
}
export function retryEvents() {
  evRetry = 0
  clearTimeout(evTimer)
  connectEvents()
}

// Dit au serveur quel agent est à l'écran : il ne notifie pas pour celui-là.
export function sendViewing() {
  if (evWs && evWs.readyState === 1) evWs.send(JSON.stringify({ type: 'viewing', pane: curPane.value, visible: pageVisible.value }))
}
watch(curPane, sendViewing)

// Pastille de l'icône : agents qui attendent ou ont fini.
watch(herdrState, (s) => {
  const n = s.panes.filter(p => p.status === 'blocked' || p.status === 'done').length
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>, clearAppBadge?: () => Promise<void> }
  try {
    if (n && nav.setAppBadge) nav.setAppBadge(n).catch(() => {})
    else if (nav.clearAppBadge) nav.clearAppBadge().catch(() => {})
  } catch { /* non géré */ }
})

// ---------------------------------------------------------------- verrouillage
let booted = false
let sessionsTimer: ReturnType<typeof setInterval> | undefined
export function boot() {
  if (booted) return
  booted = true
  locked.value = false
  connectEvents()
  sessionsTimer ||= setInterval(checkSelectedSessions, 30000)
  loadConfig()
  syncPushLanguage().catch(() => {})
}
export function showLock() {
  locked.value = true
  herdrState.value = { ok: false, workspaces: [], panes: [] }
  fullState = herdrState.value
  cachedAt.value = null
  setOfflineAccess(null)
  clearOffline()
  // Plus rien ne doit parler au serveur tant que ce n'est pas déverrouillé.
  const ws = evWs
  evWs = null
  if (ws) {
    ws.onclose = null
    try { ws.close() }
    catch { /* déjà fermée */ }
  }
  eventsOpen.value = false
  clearTimeout(evTimer)
  setNetDown(false)
  booted = false
}

export async function start() {
  let access = readOfflineAccess()
  try {
    const st = await api<AuthStatus>('/api/auth/status')
    if (st.hostLabel !== undefined) hostLabel.value = st.hostLabel
    if (st.enabled && !st.unlocked) return showLock()
    access = { enabled: st.enabled, expiresAt: st.enabled ? st.expiresAt || 0 : 0 }
    setOfflineAccess(access)
  } catch {
    if (access?.enabled && !mayReadOffline(access)) return showLock()
  }
  if (mayReadOffline(access)) {
    const saved = await readOffline()
    if (saved.home && !eventsOpen.value) {
      fullState = saved.home.state
      herdrState.value = selectSessions(fullState, machineSessions.value)
      cachedAt.value = saved.home.at
    }
  }
  boot()
}
