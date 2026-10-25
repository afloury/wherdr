import { SETTING_MAX } from '#shared/settings'
import { machineOf } from '#shared/ids'
import { EXCEPTIONS_MAX, LEVEL_EVENTS, NOTIFICATION_LEVELS, coordinatorKey, levelOf, notificationEvents, notificationException,
  paneNotificationSource, parseCoordinatorKey, parseNotificationSettings, tidyNotificationExceptions, sameNotificationTarget,
  type NotificationEvent, type NotificationException, type NotificationLevel, type NotificationSettings, type NotificationTarget } from '#shared/notificationRules'
import type { LinkedCoordinator } from '#shared/boardLinks'
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

export const levelLabel = (l: NotificationLevel | 'custom') => ({
  'muted': t('Muted'), 'needs-you': t('Needs you'), 'finished': t('Needs you + finished'), 'all': t('All activity'), 'custom': t('Custom'),
})[l]
export const levelHint = (l: NotificationLevel) => ({
  'muted': t('Nothing.'),
  'needs-you': t('A task or a coordinator is waiting for you.'),
  'finished': t('Also a finished task, or a coordinator that finished answering you.'),
  'all': t('Also every intermediate message.'),
})[l]
export const eventLabel = (e: NotificationEvent) => ({ 'needs-you': t('Needs you'), 'finished': t('Finished'), 'message': t('New message'), 'scheduled': t('Scheduled task') })[e]
export const defaultLevelLabel = () => levelLabel(levelOf(notificationRules.value.default.events))

const baseMachine = (key: string) => {
  const m = allSessionsState.value.machines?.find(x => x.key === key) ?? herdrState.value.machines?.find(x => x.key === key)
  return m?.baseKey ?? m?.key ?? key
}
export const notificationMachineName = (key: string) => machineName(key)
  || (allSessionsState.value.machines ?? herdrState.value.machines)?.find(m => m.key === key || m.baseKey === key)?.label || key || t('This machine')
export function notificationSource(pane: Pick<Pane, 'id' | 'workspace'>) {
  return paneNotificationSource(pane, herdrState.value, boardLinksNow(), baseMachine(machineOf(pane.id)))
}
// A coordinator's name, kept the same as on the Board and the home list.
export function coordinatorNotificationLabel(machine: string, key: string) {
  const k = parseCoordinatorKey(key)
  const local = (allSessionsState.value.machines ?? herdrState.value.machines)?.find(m => m.key === machine)?.local ?? !machine
  const name = coordinatorKind(k.level, local, notificationMachineName(machine), k.repo).name
  return k.session && k.session !== 'default' ? `${name} · ${k.session}` : name
}
export const coordinatorTarget = (machine: string, c: LinkedCoordinator): NotificationTarget => {
  const id = coordinatorKey(c)
  return { kind: 'coordinator', machine, id, label: coordinatorNotificationLabel(machine, id).slice(0, 120) }
}
// The exception a conversation can have: its coordinator identity, its own
// pane for a standalone agent, none for a task agent (the Sub-agents switch).
export function paneNotificationTarget(p: Pick<Pane, 'id' | 'workspace' | 'title'>): NotificationTarget | null {
  const s = notificationSource(p)
  if (s.subagent) return null
  if (s.coordinator) return { kind: 'coordinator', machine: s.machine, id: s.coordinator, label: coordinatorNotificationLabel(s.machine, s.coordinator).slice(0, 120) }
  return { kind: 'conversation', machine: s.machine, id: p.id, label: (p.title || p.id).slice(0, 120) }
}
export function paneNotificationsMuted(p: Pick<Pane, 'id' | 'workspace'>) {
  return !notificationEvents(notificationRules.value, notificationSource(p), notificationClock.value).length
}
export const findException = (target: Pick<NotificationTarget, 'kind' | 'machine' | 'id'>) =>
  notificationRules.value.exceptions.find(e => sameNotificationTarget(e, target))

export function saveNotificationRules(next: NotificationSettings) {
  if (next.exceptions.length > EXCEPTIONS_MAX || JSON.stringify(next).length > SETTING_MAX) { toast(t('Too many exceptions. Remove an old one first.'), true); return }
  notificationRules.value = next
}
// Creates or replaces a target's exception; ended timed mutes are dropped.
export function setException(target: NotificationTarget, patch: Partial<Pick<NotificationException, 'events' | 'subagents' | 'until'>>) {
  const now = Date.now()
  const old = findException(target)
  const next: NotificationException = {
    kind: target.kind, machine: target.machine, id: target.id, label: target.label.slice(0, 120),
    events: old ? old.events : [...notificationRules.value.default.events],
    subagents: old?.subagents ?? false, until: old?.until ?? null, ...patch,
  }
  if (next.until !== null && next.until <= now) next.until = null
  const exceptions = notificationRules.value.exceptions.filter(e => !sameNotificationTarget(e, target) && (e.events !== null || (e.until ?? 0) > now))
  saveNotificationRules({ ...notificationRules.value, exceptions: [...exceptions, next] })
}
export function removeException(target: Pick<NotificationTarget, 'kind' | 'machine' | 'id'>) {
  saveNotificationRules({ ...notificationRules.value, exceptions: notificationRules.value.exceptions.filter(e => !sameNotificationTarget(e, target)) })
  toast(tl(`Back to the default: ${defaultLevelLabel()}`, `Retour au défaut : ${defaultLevelLabel()}`))
}

// Saved exceptions the model does not allow (pane-keyed coordinators, task
// agents, ended timed mutes) are fixed once the board's links are known.
export function useNotificationRekey() {
  const boards = useBoardLinks()
  watch([boards, notificationRules, notificationClock], ([b, s, now]) => {
    const next = tidyNotificationExceptions(s, b, now)
    if (next) saveNotificationRules(next)
  }, { immediate: true })
}

// Right-click → Notifications: the conversation's exception, the same as in Settings.
export function notificationMenuItem(p: Pick<Pane, 'id' | 'workspace' | 'title'>): MenuItem {
  return { label: t('Notifications'), icon: 'i-lucide-bell', run: () => openNotificationMenu(p) }
}
function openNotificationMenu(p: Pick<Pane, 'id' | 'workspace' | 'title'>) {
  const settings = { label: t('Notification settings'), icon: 'i-lucide-settings-2', run: () => navigateTo('/settings?section=notifications') }
  const target = paneNotificationTarget(p)
  if (!target) {
    const on = notificationRules.value.default.subagents
    return openMenu([
      { kind: 'note', label: t('Task agents follow the Sub-agents switch of the default (or of their coordinator’s exception), never one by one.') },
      { label: on ? t('Turn sub-agents off') : t('Turn sub-agents on'), icon: on ? 'i-lucide-bell-off' : 'i-lucide-bell-ring',
        desc: tl(`Now: ${on ? 'on' : 'off'}`, `Actuellement : ${on ? 'activés' : 'coupés'}`),
        run: () => saveNotificationRules({ ...notificationRules.value, default: { ...notificationRules.value.default, subagents: !on } }) },
      { kind: 'separator' }, settings,
    ], `${t('Notifications')} · ${p.title || p.id}`)
  }
  const now = Date.now()
  const live = notificationException(notificationRules.value, notificationSource(p), now)
  const own = live && sameNotificationTarget(live, target) ? live : undefined
  const mutedUntil = own?.until && own.until > now ? own.until : null
  const current = mutedUntil ? 'muted' : levelOf(own?.events ?? notificationRules.value.default.events)
  const where = own ? t('Exception') : t('Default')
  const icons: Record<NotificationLevel, string> = { 'muted': 'i-lucide-bell-off', 'needs-you': 'i-lucide-message-circle-question-mark', 'finished': 'i-lucide-bell', 'all': 'i-lucide-bell-ring' }
  openMenu([
    ...NOTIFICATION_LEVELS.map(l => ({
      label: levelLabel(l), icon: l === current ? 'i-lucide-check' : icons[l],
      desc: l === current ? (mutedUntil ? tl(`${where} · until ${fmtTime(mutedUntil)}`, `${where} · jusqu’à ${fmtTime(mutedUntil)}`) : where) : undefined,
      run: () => setException(target, { events: [...LEVEL_EVENTS[l]], until: null }),
    })),
    { kind: 'separator' },
    { label: t('Mute for 1 hour'), icon: 'i-lucide-timer', run: () => setException(target, { until: Date.now() + 3600000, events: own ? own.events : null }) },
    { label: t('Mute for 8 hours'), icon: 'i-lucide-timer', run: () => setException(target, { until: Date.now() + 8 * 3600000, events: own ? own.events : null }) },
    { label: tl(`Follow the default (${defaultLevelLabel()})`, `Suivre le défaut (${defaultLevelLabel()})`), icon: own ? 'i-lucide-corner-up-left' : 'i-lucide-check',
      desc: own ? undefined : t('Current'), run: () => { if (own) removeException(target) } },
    { kind: 'separator' }, settings,
  ], `${t('Notifications')} · ${target.label}`)
}
