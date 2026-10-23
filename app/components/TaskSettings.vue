<script setup lang="ts">
import { settingGroup, settingGroups, settingValue, type TaskSettings } from '#shared/taskSettings'
import { taskSettingLabel, taskSettingSource, taskSettingGroupLabel } from '~/utils/taskSettings'

const props = withDefaults(defineProps<{ machine: string, id: string, active?: boolean, reachable?: boolean }>(), { active: true, reachable: true })
const data = ref<TaskSettings | null>(null)
const loading = ref(false)
const error = ref('')
const unavailable = computed(() => !props.reachable || offlineView.value)
const groups = computed(() => settingGroups.map(group => ({ group, rows: data.value?.settings.filter(row => !['board', 'coordinator', 'repo'].includes(row.kind) && settingGroup(row.name) === group) ?? [] })).filter(group => group.rows.length))
let sequence = 0
let requested = false
async function load() {
  if (!props.active || unavailable.value || requested) return
  requested = true
  const seq = ++sequence
  loading.value = true
  error.value = ''
  try {
    const result = await api<TaskSettings>(`/api/tasks/settings?machine=${encodeURIComponent(props.machine)}&id=${encodeURIComponent(props.id)}`)
    if (seq === sequence) data.value = result
  } catch (e) {
    if (seq === sequence) error.value = (e as Error).message
  } finally {
    if (seq === sequence) loading.value = false
  }
}
watch(() => [props.machine, props.id], () => {
  sequence++
  requested = false
  loading.value = false
  data.value = null
  error.value = ''
}, { flush: 'sync' })
watch(() => [props.machine, props.id, props.active, unavailable.value], () => { load() }, { immediate: true })
function retry() { requested = false; load() }
</script>

<template>
  <section class="task-settings task-sheet-block" :aria-label="tl('Settings', 'Réglages')">
    <h4>{{ tl('Settings', 'Réglages') }} · {{ tl('Read-only', 'Lecture seule') }}</h4>
    <p v-if="unavailable" class="board-note" role="status">{{ tl('Machine offline. Settings cannot be read.', 'Machine hors ligne. Impossible de lire les réglages.') }}</p>
    <p v-else-if="loading" class="board-empty" role="status">{{ t('Loading…') }}</p>
    <div v-else-if="error" role="alert" class="board-note error">
      <p>{{ tl('Could not read settings', 'Impossible de lire les réglages') }} · {{ error }}</p>
      <UButton color="neutral" variant="outline" @click="retry">{{ tl('Retry', 'Réessayer') }}</UButton>
    </div>
    <template v-else-if="data">
      <p v-for="(problem, index) in data.problems" :key="index" class="board-note error" role="alert">{{ problem }}</p>
      <p v-if="!groups.length" class="board-empty">{{ tl('No settings returned by the CLI.', 'Aucun réglage renvoyé par le CLI.') }}</p>
      <section v-for="{ group, rows } in groups" :key="group" class="settings-group">
        <h5>{{ taskSettingGroupLabel(group) }}</h5>
        <dl>
          <div v-for="(row, index) in rows" :key="`${row.name}-${index}`" class="settings-row">
            <dt>{{ taskSettingLabel(row.name) }}<small class="settings-key">{{ row.name }}</small></dt>
            <dd class="settings-value">{{ settingValue(row.value) ?? tl('Not provided', 'Non renseigné') }}</dd>
            <dd class="settings-origin">
              <span class="settings-source" :class="{ own: row.place === 'task' }">{{ taskSettingSource(row.place) }}</span>
              <span v-if="row.from">{{ row.from }}</span>
              <span v-if="row.note" class="settings-note">{{ row.note }}</span>
              <span v-if="row.later">{{ row.later }}</span>
            </dd>
          </div>
        </dl>
      </section>
    </template>
  </section>
</template>

<style scoped>
.task-settings { padding: 16px; min-width: 0; }
.settings-group { margin-top: 20px; min-width: 0; }
h5, .settings-source, .settings-key { font-family: var(--font-mono); font-size: 11px; }
h5, .settings-source { text-transform: uppercase; }
.settings-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 8px 16px; padding: 12px 0; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
.settings-key { display: block; color: var(--muted); margin-top: 4px; }
.settings-value, .settings-origin { white-space: pre-wrap; min-width: 0; margin: 0; }
.settings-value { font-family: var(--font-mono); font-size: 13px; }
.settings-origin { grid-column: 1 / -1; display: grid; gap: 6px; color: var(--muted); font-size: 12px; }
.settings-source { justify-self: start; border: 1px solid var(--line); padding: 2px 6px; }
.settings-source.own { color: var(--accent); }
@media (max-width: 480px) { .settings-row { grid-template-columns: minmax(0, 1fr); } }
</style>
