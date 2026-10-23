import { SETTING_MAX } from '#shared/settings'
import { machineOf } from '#shared/ids'
import { COORDINATOR_EVENTS, NOTIFICATION_EVENTS, notificationEvents, paneNotificationSource, parseNotificationSettings,
  sameNotificationTarget, type NotificationEvent, type NotificationTarget, type NotificationRule, type NotificationSettings } from '#shared/notificationRules'
import type { Pane } from '#shared/types'
import type { MenuItem } from './useUi'

export const notificationRules = syncedRef('notificationRules', parseNotificationSettings, JSON.stringify)
export const notificationClock = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined
let clockUsers = 0
export function useNotificationClock() {
  onMounted(() => { clockUsers++; clock ||= setInterval(() => { notificationClock.value = Date.now() }, 10000) })
  onUnmounted(() => { if (!--clockUsers) { clearInterval(clock); clock = undefined } })
}
export function notificationSource(pane: Pick<Pane, 'id' | 'workspace'>) {
  const machine = herdrState.value.machines?.find(m => m.key === machineOf(pane.id))
  return paneNotificationSource(pane, herdrState.value, boardLinksNow(), machine?.baseKey ?? machine?.key ?? machineOf(pane.id))
}
export const conversationNotificationTarget = (p: Pane): NotificationTarget => ({
  scope: 'conversation', machine: notificationSource(p).machine, id: p.id, label: p.title || p.id,
})
export const machineNotificationTarget = (machine: string, label: string): NotificationTarget => ({ scope: 'machine', machine, id: '', label })
export const projectNotificationTarget = (machine: string, repo: string): NotificationTarget => ({ scope: 'project', machine: herdrState.value.machines?.find(m => m.key === machine)?.baseKey ?? machine, id: repo, label: repo })
export function notificationsMuted(target: NotificationTarget, pane?: Pane) {
  const source = pane ? notificationSource(pane) : { machine: target.machine, ...(target.scope === 'project' ? { project: target.id } : {}) }
  return !notificationEvents(notificationRules.value, source, notificationClock.value).length
}
export function saveNotificationRules(next: NotificationSettings) {
  if (next.rules.length > 100 || JSON.stringify(next).length > SETTING_MAX) { toast(t('Too many notification rules. Remove an old rule first.'), true); return }
  notificationRules.value = next
}
export function setNotificationRule(target: NotificationTarget, mode: NotificationRule['mode'], events: NotificationEvent[] = [], until: number | null = null) {
  const rules = notificationRules.value.rules.filter(r => !sameNotificationTarget(r, target) && (r.until === null || r.until > Date.now()))
  if (mode !== 'inherit') rules.push({ ...target, label: target.label.slice(0, 120), mode, events, until })
  saveNotificationRules({ ...notificationRules.value, rules })
}
export function notificationMenuItem(target: NotificationTarget): MenuItem {
  return { label: t('Notifications'), icon: 'i-lucide-bell', run: () => openMenu([
    { label: t('All activity'), icon: 'i-lucide-bell-ring', run: () => setNotificationRule(target, 'on', [...NOTIFICATION_EVENTS]) },
    { label: t('Only needs you'), icon: 'i-lucide-message-circle-question-mark', run: () => setNotificationRule(target, 'on', ['needs-you']) },
    { label: t('Needs you and finished'), icon: 'i-lucide-bell', run: () => setNotificationRule(target, 'on', [...COORDINATOR_EVENTS]) },
    { kind: 'separator' },
    { label: t('Mute for 1 hour'), icon: 'i-lucide-bell-off', run: () => setNotificationRule(target, 'muted', [], Date.now() + 3600000) },
    { label: t('Mute for 8 hours'), icon: 'i-lucide-bell-off', run: () => setNotificationRule(target, 'muted', [], Date.now() + 8 * 3600000) },
    { label: t('Mute until turned back on'), icon: 'i-lucide-bell-off', run: () => setNotificationRule(target, 'muted') },
    { label: t('Inherit notifications'), icon: 'i-lucide-corner-up-left', run: () => setNotificationRule(target, 'inherit') },
    { kind: 'separator' },
    { label: t('Notification settings'), icon: 'i-lucide-settings-2', run: () => navigateTo('/settings?section=notifications') },
  ], `${t('Notifications')} · ${target.label}`) }
}
