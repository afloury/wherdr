// Global app state: live agents (WebSocket /ws/events), device
// settings, lock, API calls. Module singletons (client app).
import type { AppConfig, AuthStatus, HerdrState, MachineConfig, MachineInfo, NamedSession, Pane, Quotas } from '#shared/types'
import { LOCAL, splitId } from '#shared/ids'
import { clearOffline, readOffline, saveHome } from '~/utils/offlineCache'
import { mayReadOffline, readOfflineAccess, setOfflineAccess } from '~/utils/offlineAccess'
import { activeTerminalRenderer, parseTerminalRenderer } from '~/utils/terminalRenderer'
import type { ActiveTerminalRenderer } from '~/utils/terminalRenderer'
import { settleState } from '#shared/stateReady'
import { READY_SORTS, type ReadySort } from '#shared/spaces'
import { readSessionSelection, selectSessions, writeSessionSelection } from '~/utils/sessionSelection'
import { effectiveTypingSpeed, encryptedTextActive, parseTypingSettings } from '~/utils/typewriter'
import { readHiddenAgents } from '~/utils/agentChoices'
import { checkNewVersion } from './useAppVersion'
import { migrateContentWidth } from '~/utils/contentWidth'
import { readQuotaDisplay } from '~/utils/quotas'
import { readShowShells } from '~/utils/terminalVisibility'
import { paneFallback } from '~/utils/viewMode'
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
        toast(t('Session unavailable: back to the default session'))
      }
    } catch { /* machine temporarily unreachable */ }
  }
}
export const eventsOpen = ref(false)
export const netDown = ref(false)
export const cachedAt = ref<number | null>(null)
export const offlineView = computed(() => cachedAt.value !== null)
export const locked = ref(false)
export const appConfig = ref<AppConfig>({ kinds: ['claude', 'codex'], home: '', dirs: [], push: { enabled: false, key: null, devices: 0 } })
// Machine name (HOST_LABEL on the server): "<name> · herdr", otherwise "herdr".
export const hostLabel = ref('')
export const brandLabel = computed(() => 'wherdr')
export const curPane = ref<string | null>(null)
export const pageVisible = ref(true)

// Device settings.
export const showShells = ref(readShowShells(ls.get('showShells')))
watch(showShells, v => ls.set('showShells', v ? '1' : '0'))
export const showCounters = ref(ls.get('showCounters') !== '0')
watch(showCounters, v => ls.set('showCounters', v ? '1' : '0'))
export const showQuotas = ref(ls.get('showQuotas') !== '0')
watch(showQuotas, v => ls.set('showQuotas', v ? '1' : '0'))
export const autoReorderReady = ref(ls.get('autoReorderReady') !== '0')
watch(autoReorderReady, v => ls.set('autoReorderReady', v ? '1' : '0'))
// Sorting of Ready (see shared/spaces.ts sortReady), specific to the device.
export const readySort = ref<ReadySort>((READY_SORTS as readonly string[]).includes(ls.get('readySort') || '') ? ls.get('readySort') as ReadySort : 'herdr')
watch(readySort, v => ls.set('readySort', v))
// Project panel: hide lists without items (device-specific setting).
export const projectHideEmpty = ref(ls.get('projectHideEmpty') === '1')
watch(projectHideEmpty, v => ls.set('projectHideEmpty', v ? '1' : '0'))
export const quotaDisplay = ref<QuotaDisplay>(readQuotaDisplay(ls.get('quotaDisplay')))
watch(quotaDisplay, v => ls.set('quotaDisplay', v))
export const hiddenAgents = ref<string[]>(readHiddenAgents(ls.get('hiddenAgents')))
watch(hiddenAgents, v => ls.set('hiddenAgents', JSON.stringify(v)))
// Content width on a computer; migration of the old preference.
export const contentWidth = ref<ContentWidth>(migrateContentWidth(ls.get('contentWidth'), ls.get('chatWidth')))
watch(contentWidth, (v) => {
  ls.set('contentWidth', v)
  if (import.meta.client) {
    try { localStorage.removeItem('chatWidth') } catch { /* stockage indisponible */ }
    document.documentElement.dataset.contentWidth = v
  }
}, { immediate: true })
// Independent settings; migration of the old modes on first read.
const savedTyping = parseTypingSettings(ls.get('typewriterSpeed'), ls.get('encryptedText'), ls.get('typewriterMode'), ls.get('typewriter'))
// Writes the new keys right at migration so as no longer to depend on the
// old values on the next launches.
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
// Account quotas (read by QuotaStrip, also shown in the machine headers).
export const homeQuotas = ref<Quotas | null>(null)
export const fontSize = ref(Number(ls.get('fontSize')) || 12)
watch(fontSize, v => ls.set('fontSize', String(v)))
export const terminalRenderer = ref(parseTerminalRenderer(ls.get('terminalRenderer')))
watch(terminalRenderer, v => ls.set('terminalRenderer', v))
// The engine actually loaded in xterm; kept after the terminal view
// is closed so Settings can show the last observed result.
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
// Presentation mode per pane: only an explicit choice is remembered (the
// selector, Ctrl+`, the phone icons — 'chat' included, so switching back
// sticks); a pane without one follows the device default on a computer
// (defaultViewMode, chosen in Settings › Desktop), the conversation on the
// phone. A change of the default applies at once to the panes without one.
export type PaneViewMode = 'chat' | 'term' | 'project'
function loadViewModes(): Record<string, PaneViewMode> {
  try {
    const v = JSON.parse(ls.get('viewModes') || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}
const viewModes = reactive(loadViewModes())
export const defaultViewMode = ref<'chat' | 'term'>(ls.get('defaultViewMode') === 'term' ? 'term' : 'chat')
watch(defaultViewMode, v => ls.set('defaultViewMode', v))
export const paneViewMode = (id: string): PaneViewMode =>
  (viewModes[id] === 'term' || viewModes[id] === 'project' || viewModes[id] === 'chat' ? viewModes[id] : paneFallback({ desk: desk.value, defaultMode: defaultViewMode.value }))
export function setPaneViewMode(id: string, m: PaneViewMode) {
  viewModes[id] = m
  ls.set('viewModes', JSON.stringify(viewModes))
}
// Vanished panes: we forget their tab, but only for online
// machines (a machine not yet reconnected has not listed its panes yet).
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

// Computer (≥ 900 px): list as a sidebar, agent on the right.
export const desk = ref(false)
if (import.meta.client) {
  const mq = matchMedia('(min-width: 900px)')
  desk.value = mq.matches
  mq.addEventListener('change', () => { desk.value = mq.matches })
}

export const currentPane = computed<Pane | undefined>(() => herdrState.value.panes.find(p => p.id === curPane.value))

// ---------------------------------------------------------------- machines
// Several machines (Herdr SSH profiles): `machines` is only sent if
// there are at least two; with a single one, the app stays exactly as before.
export const machines = computed<MachineInfo[]>(() => herdrState.value.machines || [])
export const multiMachine = computed(() => machines.value.length > 1 || Boolean(machines.value[0]?.baseKey))
export const machineInfo = (key: string | null | undefined) => machines.value.find(m => m.key === (key || ''))
// `uname -s` of a pane's machine ('Darwin' = macOS); the local one from the config.
export const machineOs = (key: string | null | undefined) => machineInfo(key)?.os || (key ? undefined : appConfig.value.os)
// Machines offered by the "New agent" and "New project" sheets (null
// with a single machine); online according to the live state (the config may
// have been read before the connection).
export const machineChoices = computed(() => (multiMachine.value ? (appConfig.value.machines || []).filter(m => machines.value.some(s => s.key === m.key)) : null))
export const machineOnline = (m: MachineConfig) => m.local || (machineInfo(m.key)?.status === 'online' && Boolean(m.home))
export const machineStateOf = (m: MachineConfig) => (m.local ? 'online' : machineInfo(m.key)?.status || 'offline')
export const machineName = (key: string | null | undefined) => {
  const m = machineInfo(key)
  return m ? m.label || t('This machine') : ''
}
// Pane of an unreachable machine: its last state, grayed out.
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
// Collapsed machine sections (kept on the device).
export const collapsedMachines = ref<string[]>(readList('collapsedMachines'))
watch(collapsedMachines, v => ls.set('collapsedMachines', JSON.stringify(v)))
// Collapsed herdr-projects projects ("<machine>|<project>", kept on the device).
export const collapsedProjects = ref<string[]>(readList('collapsedProjects'))
watch(collapsedProjects, v => ls.set('collapsedProjects', JSON.stringify(v)))
// Collapsed repositories, by machine, project and repository path on this device.
export const collapsedRepos = ref<string[]>(readList('collapsedRepos'))
watch(collapsedRepos, v => ls.set('collapsedRepos', JSON.stringify(v)))
// Last machine chosen in "New".
export const lastMachine = ref(ls.get('lastMachine') || '')
watch(lastMachine, v => ls.set('lastMachine', v))

// ---------------------------------------------------------------- toasts
type Toaster = ReturnType<typeof useToast>
let toaster: Toaster | null = null
export function setToaster(t: Toaster) { toaster = t }
// `detail`: an extra, smaller line (output of a plugin action…).
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
  // Session expired (12 h) or app locked: back through the passkey.
  if (r.status === 401 && data.code === 'locked' && !path.startsWith('/api/auth/')) showLock()
  // Erreurs de Herdr transmises telles quelles (en anglais) : message traduit par code.
  const known = data.code === 'agent_not_ready' ? 'The agent isn’t ready in this pane (stopped or still starting).' : null
  if (!r.ok) throw new ApiError(t(known || data.error || `HTTP ${r.status}`), r.status, data.code)
  return data as T
}

export async function loadConfig() {
  try {
    appConfig.value = await api<AppConfig>('/api/config')
    if (appConfig.value.hostLabel !== undefined) hostLabel.value = appConfig.value.hostLabel
  }
  catch { /* keep the previous one */ }
}

// ---------------------------------------------------------------- live state
let evWs: WebSocket | null = null
let evRetry = 0
// Reconnection after a cut: the server may have restarted (see settleState).
let everOpen = false
let settleUntil = 0
const SETTLE_MS = 30000
let lastStateAt: number | null = null
let evTimer: ReturnType<typeof setTimeout> | undefined
let netTimer: ReturnType<typeof setTimeout> | undefined
const wsBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

// "Connection lost" banner: shown if the server stays unreachable for more than
// 2.5 s (a lightning reconnection does not flicker).
function setNetDown(down: boolean) {
  if (!down) {
    clearTimeout(netTimer)
    netTimer = undefined
    netDown.value = false
    return
  }
  // Already shown or about to be: the following attempts do not push the delay back.
  if (netDown.value || netTimer) return
  netTimer = setTimeout(() => {
    netTimer = undefined
    netDown.value = true
  }, 2500)
}

function normalize(s: HerdrState): HerdrState {
  // A question on screen (e.g. Codex's folder trust, which Herdr
  // sees as "idle"): for the user, the agent is waiting for their answer.
  // Same for a recognized waiting screen (Codex hooks, login…).
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
    if (everOpen) {
      settleUntil = Date.now() + SETTLE_MS
      // Reconnection = often a redeployment: we check right away whether
      // a new version is served ("Reload" banner).
      checkNewVersion()
    }
    everOpen = true
    sendViewing()
    restoreMachineSessions()
  }
  ws.onmessage = (e) => {
    try {
      const got = normalize(JSON.parse(e.data)) as HerdrState
      // Server just restarted, state still partial: we keep the whole
      // display, the "reconnecting" banner stays in place.
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
    // Refused because of the lock (session expired) rather than a network cut?
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

// Tells the server which agent is on screen: it does not notify for that one.
export function sendViewing() {
  if (evWs && evWs.readyState === 1) evWs.send(JSON.stringify({ type: 'viewing', pane: curPane.value, visible: pageVisible.value }))
}
watch(curPane, sendViewing)

// Icon badge: agents waiting or finished.
watch(herdrState, (s) => {
  const n = s.panes.filter(p => p.status === 'blocked' || p.status === 'done').length
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>, clearAppBadge?: () => Promise<void> }
  try {
    if (n && nav.setAppBadge) nav.setAppBadge(n).catch(() => {})
    else if (nav.clearAppBadge) nav.clearAppBadge().catch(() => {})
  } catch { /* not supported */ }
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
  // Nothing must talk to the server any more until it is unlocked.
  const ws = evWs
  evWs = null
  if (ws) {
    ws.onclose = null
    try { ws.close() }
    catch { /* already closed */ }
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
