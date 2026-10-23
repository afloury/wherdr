<script setup lang="ts">
// Settings › Notifications: a default for everything, and exceptions to it.
import { LEVEL_EVENTS, compareEvents, levelOf, sameNotificationTarget, type NotificationEvent, type NotificationException, type NotificationTarget } from '#shared/notificationRules'
useNotificationClock()
useNotificationRekey()
const boards = useBoardLinks()
const rules = notificationRules
const now = notificationClock

function setDefault(patch: { events?: NotificationEvent[], subagents?: boolean }) {
  saveNotificationRules({ ...rules.value, default: { ...rules.value.default, ...patch } })
}
const defaultEvents = computed(() => rules.value.default.events)

// Exceptions, by machine then name (ended timed mutes that left nothing are gone).
const exceptions = computed(() => rules.value.exceptions
  .filter(e => e.events !== null || (e.until ?? 0) > now.value)
  .map(e => ({ e, machine: notificationMachineName(e.machine), name: exceptionName(e) }))
  .sort((a, b) => a.machine.localeCompare(b.machine) || a.name.localeCompare(b.name)))
function exceptionName(e: NotificationTarget) {
  return e.kind === 'coordinator' ? coordinatorNotificationLabel(e.machine, e.id) : livePaneTitle(e.id) || e.label
}
const livePaneTitle = (id: string) => herdrState.value.panes.find(p => p.id === id)?.title || ''
const mutedUntil = (e: NotificationException) => e.until !== null && e.until > now.value ? e.until : null
const eventsOf = (e: NotificationException) => e.events ?? defaultEvents.value
function difference(e: NotificationException) {
  const base = defaultLevelLabel()
  const until = mutedUntil(e)
  if (until) return e.events === null
    ? tl(`Muted until ${fmtDateTime(until)}, then back to the default (${base})`, `Muet jusqu’au ${fmtDateTime(until)}, puis retour au défaut (${base})`)
    : tl(`Muted until ${fmtDateTime(until)}, then ${levelLabel(levelOf(e.events))}`, `Muet jusqu’au ${fmtDateTime(until)}, puis ${levelLabel(levelOf(e.events))}`)
  const c = compareEvents(eventsOf(e), defaultEvents.value)
  return c === 1 ? tl(`Louder than the default (${base})`, `Plus que le défaut (${base})`)
    : c === -1 ? tl(`Quieter than the default (${base})`, `Moins que le défaut (${base})`)
      : c === 0 ? tl(`Same as the default (${base})`, `Identique au défaut (${base})`)
        : tl(`Different from the default (${base})`, `Différent du défaut (${base})`)
}
const kindLabel = (e: NotificationTarget) => e.kind === 'coordinator' ? t('Coordinator') : t('Conversation')

// "Add an exception": a coordinator of a board, or a standalone agent
// conversation, grouped by machine. Never task threads or sub-agents.
const picking = ref(false)
const candidates = computed(() => {
  const groups = new Map<string, { machine: string, name: string, items: NotificationTarget[] }>()
  const add = (t: NotificationTarget) => {
    if (rules.value.exceptions.some(e => sameNotificationTarget(e, t))) return
    const g = groups.get(t.machine) ?? { machine: t.machine, name: notificationMachineName(t.machine), items: [] }
    if (!g.items.some(x => sameNotificationTarget(x, t))) g.items.push(t)
    groups.set(t.machine, g)
  }
  const order = { top: 0, machine: 1, project: 2 }
  for (const b of boards.value) {
    for (const c of [...b.coordinators].sort((x, y) => order[x.level] - order[y.level] || (x.repo ?? '').localeCompare(y.repo ?? ''))) add(coordinatorTarget(b.machine, c))
  }
  for (const p of herdrState.value.panes) {
    if (!p.agent) continue
    const target = paneNotificationTarget(p)
    if (target?.kind === 'conversation') add(target)
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
})
function addException(t: NotificationTarget) {
  // Start one step away from the default, so the exception does something.
  const muted = levelOf(defaultEvents.value) === 'muted'
  setException(t, { events: muted ? [...LEVEL_EVENTS.finished] : [], subagents: false, until: null })
  picking.value = false
}
function removeAll() {
  saveNotificationRules({ ...rules.value, exceptions: [] })
  toast(tl(`All exceptions removed. Everything follows the default: ${defaultLevelLabel()}`, `Exceptions retirées. Tout suit le défaut : ${defaultLevelLabel()}`))
}
</script>

<template>
  <div class="notification-rules" data-testid="notification-rules">
    <div class="settings-group notification-default" data-testid="notification-default">
      <h3>{{ t('Default (applies to everything)') }}</h3>
      <NotificationLevel :events="defaultEvents" :label="t('Default level')" @change="events => setDefault({ events })" />
      <label class="settings-toggle notification-subagents">
        <span><b>{{ t('Sub-agents') }}</b><small>{{ rules.default.subagents
          ? t('On: task agents (workers, reviewers, attempts) notify too, at the same level.')
          : t('Off: only coordinators, standalone agents and board events notify. Task agents stay silent.') }}</small></span>
        <USwitch color="success" size="xl" :model-value="rules.default.subagents" :aria-label="t('Sub-agents')" @update:model-value="v => setDefault({ subagents: v })" />
      </label>
      <p class="muted notification-help">{{ t('Visible conversations stay silent on every device. Push resumes after about 30 seconds away. Inactive tabs expire automatically.') }}</p>
    </div>

    <div class="settings-group notification-exceptions" data-testid="notification-exceptions">
      <h3>{{ t('Exceptions') }}</h3>
      <p v-if="!exceptions.length" class="muted">{{ t('No exceptions: everything follows the default. Add one for a coordinator or an agent, or use Notifications in its menu.') }}</p>
      <article v-for="{ e, machine, name } in exceptions" :key="JSON.stringify([e.kind, e.machine, e.id])" class="notification-rule" data-testid="notification-exception">
        <div class="notification-rule-head">
          <small>{{ machine }} · {{ kindLabel(e) }}</small>
          <b>{{ name }}</b>
          <small class="notification-diff">{{ difference(e) }}</small>
        </div>
        <NotificationLevel :events="eventsOf(e)" :muted="!!mutedUntil(e)" :label="tl(`Notifications: ${name}`, `Notifications : ${name}`)" @change="events => setException(e, { events, until: null })" />
        <label v-if="e.kind === 'coordinator'" class="settings-toggle notification-subagents">
          <span><b>{{ t('Sub-agents') }}</b><small>{{ e.subagents
            ? t('On: the task agents of this board follow this exception.')
            : t('Off: only this coordinator. Its board’s task agents follow the default.') }}</small></span>
          <USwitch color="success" size="lg" :model-value="e.subagents" :aria-label="tl(`Sub-agents: ${name}`, `Sous-agents : ${name}`)" @update:model-value="v => setException(e, { subagents: v })" />
        </label>
        <button type="button" class="settings-action" @click="removeException(e)">
          <UIcon name="i-lucide-x" />{{ t('Remove exception') }}<small class="muted">{{ tl(`Back to the default: ${defaultLevelLabel()}`, `Retour au défaut : ${defaultLevelLabel()}`) }}</small>
        </button>
      </article>

      <button type="button" class="settings-action solo notification-add" :aria-expanded="picking" @click="picking = !picking"><UIcon name="i-lucide-plus" />{{ t('Add an exception') }}</button>
      <div v-if="picking" class="notification-picker" data-testid="notification-picker">
        <p v-if="!candidates.length" class="muted">{{ t('No coordinator or agent conversation to add. Task agents follow the Sub-agents switch.') }}</p>
        <div v-for="g in candidates" :key="g.machine" class="notification-picker-group">
          <small>{{ g.name }}</small>
          <button v-for="c in g.items" :key="c.kind + c.id" type="button" class="settings-action" @click="addException(c)">
            <UIcon :name="c.kind === 'coordinator' ? 'i-lucide-message-square-text' : 'i-lucide-bot'" />{{ c.label }}
          </button>
        </div>
      </div>
      <button v-if="exceptions.length" type="button" class="settings-action solo notification-reset" @click="removeAll"><UIcon name="i-lucide-rotate-ccw" />{{ t('Remove all exceptions') }}</button>
    </div>
  </div>
</template>

<style scoped>
.notification-rules .settings-toggle { gap:16px; }
.notification-rules .settings-toggle > span { flex:1; min-width:0; }
.notification-default > :deep(.notification-level) { margin-bottom:8px; }
.notification-help { font-size:12px; margin:8px 0 0; }
.notification-rule { border:1px solid var(--line); margin:12px 0; padding:14px; display:flex; flex-direction:column; gap:10px; min-width:0; }
.notification-rule-head b,.notification-rule-head small { display:block; overflow-wrap:anywhere; }
.notification-rule-head small { color:var(--muted); font:11px var(--mono); margin-bottom:4px; }
.notification-rule-head .notification-diff { font:12px var(--sans, inherit); margin:4px 0 0; }
.notification-rule .settings-action small { margin-left:auto; padding-left:8px; font-size:11px; }
.notification-add { margin-top:12px; }
.notification-picker { border:1px solid var(--line); padding:12px; margin-top:8px; display:flex; flex-direction:column; gap:12px; }
.notification-picker-group { display:flex; flex-direction:column; gap:4px; }
.notification-picker-group > small { color:var(--muted); font:11px var(--mono); }
.notification-reset { margin-top:16px; }
</style>
