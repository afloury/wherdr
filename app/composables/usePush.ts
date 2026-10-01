// Notifications Web Push : abonnement de l'appareil, test, langue des notifs.
import type { NotifyScope } from '../../server/utils/notificationPolicy'
import { type Quiet, type QuietScope, quietActive } from '../../shared/quiet'

const scopeKey = 'pushNotifyScope'
function savedScope(): NotifyScope {
  try { return localStorage.getItem(scopeKey) === 'all' ? 'all' : 'project_leads' }
  catch { return 'project_leads' }
}
export const notifyScope = ref<NotifyScope>(import.meta.client ? savedScope() : 'project_leads')

export async function setNotifyScope(scope: NotifyScope) {
  notifyScope.value = scope
  try { localStorage.setItem(scopeKey, scope) } catch { /* stockage indisponible */ }
  await syncPushLanguage()
}

function urlB64ToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  return b64ToBytes((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
}

export async function pushSubscribed() {
  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return false
    const reg = await navigator.serviceWorker.ready
    return Boolean(await reg.pushManager.getSubscription())
  } catch { return false }
}

export async function syncPushLanguage(lang = language) {
  if (!('serviceWorker' in navigator) || !('Notification' in window) || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) await api('/api/push/subscribe', { ...sub.toJSON(), lang, notifyScope: notifyScope.value, sessions: machineSessions.value })
}

const LAST_ENDPOINT = 'pushEndpoint'
function readLastEndpoint() {
  try { return localStorage.getItem(LAST_ENDPOINT) || undefined } catch { return undefined }
}
export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return toast(t(isIOS && !standalone
      ? 'Add the app to your Home Screen (Share → Add to Home Screen), then open it from the icon.'
      : 'Notifications are unavailable in this browser.'), true)
  }
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return toast(t('Notifications denied — enable them in system settings.'), true)
    await loadConfig()
    if (!appConfig.value.push || !appConfig.value.push.key) return toast(t('Web Push is not configured on the server'), true)
    const reg = await navigator.serviceWorker.ready
    const key = urlB64ToUint8(appConfig.value.push.key)
    let sub = await reg.pushManager.getSubscription()
    // Ancien endpoint (abonnement courant, sinon le dernier connu si le
    // navigateur l'a déjà perdu) : le serveur le remplace et garde son silence.
    const previous = sub?.endpoint || readLastEndpoint()
    if (sub) await sub.unsubscribe().catch(() => {})
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await api('/api/push/subscribe', { ...sub.toJSON(), previous, lang: language, notifyScope: notifyScope.value, sessions: machineSessions.value })
    try { localStorage.setItem(LAST_ENDPOINT, sub.endpoint) } catch { /* stockage indisponible */ }
    toast(t('Notifications enabled ✓'))
  } catch (err) {
    toast(`${t('Failed')} : ${(err as Error).message}`, true)
  }
}

export async function testPush() {
  try {
    const r = await api<{ sent: number }>('/api/push/test', {})
    toast(t(r.sent ? 'Notification sent' : 'No device accepted the notification'), !r.sent)
  } catch (err) { toast((err as Error).message, true) }
}

// ------------------------------------------------------------ mode silence
// État lu sur le serveur (le filtre s'applique là-bas, avant l'envoi). `now`
// avance chaque minute : un silence expiré disparaît de l'interface tout seul.
export const quietState = ref<{ global: Quiet | null, device: Quiet | null }>({ global: null, device: null })
export const quietNow = ref(Date.now())
if (import.meta.client) setInterval(() => { quietNow.value = Date.now() }, 30000)

// Silence en cours vu par cet appareil : le sien d'abord, sinon celui de tous.
export const quietCurrent = computed<{ scope: QuietScope, quiet: Quiet } | null>(() => {
  const { global, device } = quietState.value
  if (quietActive(device, quietNow.value)) return { scope: 'device', quiet: device! }
  if (quietActive(global, quietNow.value)) return { scope: 'all', quiet: global! }
  return null
})

async function pushEndpoint(): Promise<string> {
  try {
    if (!('serviceWorker' in navigator)) return ''
    const reg = await navigator.serviceWorker.ready
    return (await reg.pushManager.getSubscription())?.endpoint || ''
  } catch { return '' }
}

export async function refreshQuiet() {
  try {
    quietState.value = await api('/api/push/quiet', { endpoint: await pushEndpoint() })
    quietNow.value = Date.now()
  } catch { /* on garde le dernier état connu */ }
}

export async function setQuiet(scope: QuietScope, on: boolean, until: number | null = null) {
  quietState.value = await api('/api/push/quiet', { endpoint: await pushEndpoint(), scope, on, until })
  quietNow.value = Date.now()
}

// Indicateur de l'accueil : coupe tous les silences qui touchent cet appareil.
export async function endQuiet() {
  try {
    const { global, device } = quietState.value
    if (quietActive(device)) await setQuiet('device', false)
    if (quietActive(global)) await setQuiet('all', false)
    toast(tl('Notifications back on', 'Notifications réactivées'))
  } catch (err) { toast((err as Error).message, true) }
}
