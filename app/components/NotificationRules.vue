<script setup lang="ts">
import { COORDINATOR_EVENTS, NOTIFICATION_EVENTS, defaultNotifications, type NotificationEvent, type NotificationRule } from '#shared/notificationRules'
useNotificationClock()
const boards = useBoardLinks()
function setMuteSubagents(value: boolean) { saveNotificationRules({ ...notificationRules.value, muteSubagents: value }) }
function resetRules() { saveNotificationRules(defaultNotifications()) }
const active = computed(() => notificationRules.value.rules.filter(r => r.mode !== 'inherit' && (r.until === null || r.until > notificationClock.value)))
const eventLabel = (e: NotificationEvent) => ({ 'needs-you': t('Needs you'), finished: t('Finished'), message: t('New message'), scheduled: t('Scheduled task') })[e]
const sourceMachineName = (key: string) => machineName(key) || allSessionsState.value.machines?.find(m => m.key === key || m.baseKey === key)?.label || key || t('This machine')
const scopeLabel = (r: NotificationRule) => r.scope === 'machine' ? t('Machine') : r.scope === 'project' ? t('Project') : t('Conversation')
function defaults(value: string) {
  saveNotificationRules({ ...notificationRules.value, defaults: value === 'all' ? [...NOTIFICATION_EVENTS] : value === 'coordinator' ? [...COORDINATOR_EVENTS] : [] })
}
const defaultMode = computed(() => !notificationRules.value.defaults.length ? 'muted' : notificationRules.value.defaults.length === 4 ? 'all' : 'coordinator')
function changeMode(rule: NotificationRule, value: string) {
  setNotificationRule(rule, value === 'muted' ? 'muted' : value === 'inherit' ? 'inherit' : 'on',
    value === 'all' ? [...NOTIFICATION_EVENTS] : value === 'needs' ? ['needs-you'] : [...COORDINATOR_EVENTS])
}
function changeEvent(rule: NotificationRule, event: NotificationEvent, checked: boolean) {
  setNotificationRule(rule, 'on', checked ? [...new Set([...rule.events, event])] : rule.events.filter(e => e !== event), rule.until)
}
function coordinatorsOnly() {
  const top = boards.value.flatMap(b => b.coordinators.filter(c => c.level === 'top' && c.pane).map(c => ({ board: b, coordinator: c })))
  if (!top.length) return
  const machines = allSessionsState.value.machines || herdrState.value.machines || []
  const bases = new Map(machines.map(m => [m.baseKey ?? m.key, m.label]))
  for (const b of boards.value) if (!bases.has(b.machine)) bases.set(b.machine, sourceMachineName(b.machine))
  saveNotificationRules({ defaults: [], muteSubagents: true, rules: [
    ...[...bases].map(([key, label]) => ({
      ...machineNotificationTarget(key, label), mode: 'muted' as const, events: [], until: null,
    })),
    ...top.map(({ board, coordinator }) => ({ scope: 'conversation' as const, machine: board.machine, id: coordinator.pane!,
      label: t('Main coordinator'), mode: 'on' as const, events: [...COORDINATOR_EVENTS], until: null })),
  ] })
}
</script>

<template>
  <div class="settings-group notification-rules" data-testid="notification-rules">
    <h3>{{ t('Notification rules') }}</h3>
    <p class="muted">{{ t('Quiet by default. The most specific rule wins: machine → project → conversation.') }}</p>
    <label class="settings-toggle">
      <span><b>{{ t('Default notifications') }}</b><small>{{ t('Coordinators notify for needs you and finished unless a rule overrides them.') }}</small></span>
      <select :value="defaultMode" :aria-label="t('Default notifications')" @change="defaults(($event.target as HTMLSelectElement).value)">
        <option value="muted">{{ t('Muted') }}</option><option value="coordinator">{{ t('Needs you and finished') }}</option><option value="all">{{ t('All activity') }}</option>
      </select>
    </label>
    <label class="settings-toggle"><span><b>{{ t('Mute sub-agents') }}</b><small>{{ t('Workers, reviewers and attempts stay silent. Enable a conversation to override this preset.') }}</small></span>
      <USwitch color="success" size="xl" :model-value="notificationRules.muteSubagents" :aria-label="t('Mute sub-agents')" @update:model-value="setMuteSubagents" />
    </label>
    <p class="muted">{{ t('Visible conversations stay silent on every device. Push resumes after about 30 seconds away. Inactive tabs expire automatically.') }}</p>
    <button type="button" class="settings-action solo notification-preset" :disabled="!boards.some(b => b.coordinators.some(c => c.level === 'top' && c.pane))" @click="coordinatorsOnly"><UIcon name="i-lucide-message-square-text" />{{ t('Only main coordinators') }}</button>
    <h3>{{ t('Active rules') }}</h3>
    <p v-if="!active.length" class="muted">{{ t('No overrides. Use the Notifications menu on a machine, project or conversation.') }}</p>
    <article v-for="rule in active" :key="JSON.stringify([rule.scope, rule.machine, rule.id])" class="notification-rule">
      <div class="notification-rule-head"><div><small>{{ scopeLabel(rule) }} · {{ sourceMachineName(rule.machine) }}</small><b>{{ rule.label }}</b>
        <small v-if="rule.until">{{ tl(`Muted until ${fmtDateTime(rule.until)}`, `Muet jusqu’au ${fmtDateTime(rule.until)}`) }}</small></div>
        <select :value="rule.mode === 'muted' ? 'muted' : rule.events.length === 4 ? 'all' : rule.events.length === 1 && rule.events[0] === 'needs-you' ? 'needs' : rule.events.length === 2 && rule.events.includes('needs-you') && rule.events.includes('finished') ? 'coordinator' : 'custom'" :aria-label="tl(`Notifications: ${rule.label}`, `Notifications : ${rule.label}`)" @change="changeMode(rule, ($event.target as HTMLSelectElement).value)">
          <option value="custom" disabled>{{ t('Custom events') }}</option><option value="coordinator">{{ t('Needs you and finished') }}</option><option value="all">{{ t('All activity') }}</option><option value="needs">{{ t('Only needs you') }}</option><option value="muted">{{ t('Muted') }}</option><option value="inherit">{{ t('Inherit notifications') }}</option>
        </select>
      </div>
      <div v-if="rule.mode === 'on'" class="notification-events"><label v-for="event in NOTIFICATION_EVENTS" :key="event"><input type="checkbox" :checked="rule.events.includes(event)" @change="changeEvent(rule, event, ($event.target as HTMLInputElement).checked)"> {{ eventLabel(event) }}</label></div>
      <button type="button" class="settings-action" @click="setNotificationRule(rule, 'inherit')">{{ t('Remove rule') }}</button>
    </article>
    <button type="button" class="settings-action solo notification-reset" @click="resetRules"><UIcon name="i-lucide-rotate-ccw" />{{ t('Reset notification rules') }}</button>
  </div>
</template>

<style scoped>
.notification-rules select { max-width:100%; min-height:44px; padding:8px; border:1px solid var(--line); border-radius:0; background:var(--bg); color:var(--text); font:inherit; }
.notification-rules .settings-toggle { gap:16px; flex-wrap:wrap; }
.notification-rules .settings-toggle > span { flex:1; min-width:180px; }
.notification-rules > p { margin:12px 0 18px; }
.notification-preset { margin-bottom:28px; }
.notification-preset:disabled { opacity:.5; cursor:not-allowed; }
.notification-reset { margin-top:16px; }
.notification-rule { border:1px solid var(--line); margin:12px 0; padding:14px; }
.notification-rule-head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
.notification-rule-head b,.notification-rule-head small { display:block; overflow-wrap:anywhere; }
.notification-rule-head small { color:var(--muted); font:11px var(--mono); margin-bottom:6px; }
.notification-events { display:flex; flex-wrap:wrap; gap:12px 18px; margin:16px 0; }
.notification-events label { display:flex; align-items:center; min-height:44px; gap:6px; }
.notification-events input { accent-color:var(--accent); }
</style>
