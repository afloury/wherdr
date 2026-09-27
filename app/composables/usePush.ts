// Notifications Web Push : abonnement de l'appareil, test, langue des notifs.
import type { NotifyScope } from '../../server/utils/notificationPolicy'

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

export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return toast(t(isIOS && !standalone
      ? 'Ajoute d’abord l’app à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis ouvre-la depuis l’icône.'
      : 'Notifications non disponibles dans ce navigateur.'), true)
  }
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return toast(t('Notifications refusées — réactive-les dans Réglages.'), true)
    await loadConfig()
    if (!appConfig.value.push || !appConfig.value.push.key) return toast(t('Web Push non configuré sur le serveur'), true)
    const reg = await navigator.serviceWorker.ready
    const key = urlB64ToUint8(appConfig.value.push.key)
    let sub = await reg.pushManager.getSubscription()
    if (sub) await sub.unsubscribe().catch(() => {})
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await api('/api/push/subscribe', { ...sub.toJSON(), lang: language, notifyScope: notifyScope.value, sessions: machineSessions.value })
    toast(t('Notifications activées ✓'))
  } catch (err) {
    toast(`${t('Échec')} : ${(err as Error).message}`, true)
  }
}

export async function testPush() {
  try {
    const r = await api<{ sent: number }>('/api/push/test', {})
    toast(t(r.sent ? 'Notification envoyée' : 'Aucun appareil n’a accepté la notification'), !r.sent)
  } catch (err) { toast((err as Error).message, true) }
}
