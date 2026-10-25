<script setup lang="ts">
import type { CoordinatorTarget } from '#shared/projectsTasks'
import { WAKEUP_ID, type Scheduled } from '#shared/scheduled'
import { language } from '~/utils/i18n'

const props = defineProps<{ machine: string, target: CoordinatorTarget, refreshKey?: number }>()
const open = ref(false)
const data = shallowRef<Scheduled | null>(null)
const error = ref('')
const loading = ref(false)
let generation = 0
async function load() {
  const n = ++generation
  loading.value = true
  error.value = ''
  const q = new URLSearchParams({ machine: props.machine, kind: props.target.kind, ...(props.target.kind === 'project' ? { repo: props.target.repo } : {}) })
  try {
    const r = await api<Scheduled>(`/api/tasks/scheduled?${q}`)
    if (n === generation) data.value = r
  } catch { if (n === generation) error.value = tl('Schedule unavailable', 'Programmation indisponible') }
  finally { if (n === generation) loading.value = false }
}
function toggle(event: Event) {
  const nextOpen = (event.target as HTMLDetailsElement).open
  if (nextOpen === open.value) return
  open.value = nextOpen
  if (open.value) {
    data.value = null
    load()
  }
}
watch(() => [props.machine, JSON.stringify(props.target)], () => {
  generation++; data.value = null; error.value = ''; loading.value = false
  if (open.value) load()
})
watch(() => props.refreshKey, () => { if (open.value) load(); else data.value = null })
onBeforeUnmount(() => generation++)
const empty = computed(() => data.value && !data.value.autopilot?.on && !data.value.automations.length && !data.value.timers.length)
function time(value: number | string | null) {
  if (!value) return '—'
  if (typeof value === 'string') return words(value)
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: data.value?.timezone || 'UTC', dateStyle: 'short', timeStyle: 'short' }).format(value)
}
// The board's JSON includes plain English trigger and status descriptions.
function words(value: string) {
  if (language !== 'fr') return value
  return value.replace(/when a task is merged/g, 'après chaque fusion').replace(/when a task is added/g, 'après chaque ajout de tâche')
    .replace(/when a task waits for approval/g, 'quand une tâche attend une approbation').replace(/when a task failed its review/g, 'après un échec de relecture')
    .replace(/when a task went wrong/g, 'après un échec de tâche').replace(/when a task needs you/g, 'quand une tâche a besoin de toi')
    .replace(/in every repo/g, 'dans tous les projets').replace(/every /g, 'tous les ').replace(/daily /g, 'tous les jours à ')
    .replace(/\bmon\b/gi, 'lundis').replace(/\btue\b/gi, 'mardis').replace(/\bwed\b/gi, 'mercredis').replace(/\bthu\b/gi, 'jeudis')
    .replace(/\bfri\b/gi, 'vendredis').replace(/\bsat\b/gi, 'samedis').replace(/\bsun\b/gi, 'dimanches')
    .replace(/\bon done stuck added\b/g, 'sur fin, blocage, ajout').replace(/next in /g, 'dans ').replace(/next /g, 'prochain ').replace(/\bof\b/g, 'sur').replace(/added/g, 'ajoutées').replace(/under way/g, 'en cours')
}
function trigger(value: string) {
  const weekly = /^(mon|tue|wed|thu|fri|sat|sun)(?:,(?:mon|tue|wed|thu|fri|sat|sun))* (\d{1,2}:\d{2})$/i.exec(value)
  if (weekly) {
    const [days, hour] = value.split(' ')
    const names: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
    return language === 'fr' ? `Tous les ${words(days!)} à ${hour}` : `Every ${days!.split(',').map(d => names[d.toLowerCase()]).join(', ')} at ${hour}`
  }
  const cron = /^(?:cron\s+)?(\d+) (\d+) \* \* ([0-6])$/.exec(value)
  if (cron) {
    const days = language === 'fr' ? ['dimanches', 'lundis', 'mardis', 'mercredis', 'jeudis', 'vendredis', 'samedis'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return tl(`Every ${days[Number(cron[3])]} at ${cron[2]}:${cron[1]!.padStart(2, '0')}`, `Tous les ${days[Number(cron[3])]} à ${cron[2]}:${cron[1]!.padStart(2, '0')}`)
  }
  return words(value)
}
const taskLink = (id: string) => `/#/board?machine=${encodeURIComponent(props.machine)}&task=${encodeURIComponent(id)}`
</script>

<template>
  <details class="coordinator-scheduled" @toggle="toggle">
    <summary>{{ tl('Scheduled', 'Programmé') }}</summary>
    <div class="scheduled-content">
      <p v-if="loading">{{ t('Loading…') }}</p>
      <p v-if="error" role="status">{{ error }}</p>
      <template v-if="data">
        <p v-for="warning in data.warnings" :key="warning" role="status">{{ t(warning) }}</p>
        <p v-if="empty && !data.warnings.length">{{ tl('Nothing scheduled', 'Rien de programmé') }}</p>
        <article v-if="data.autopilot">
          <h4>Autopilot <span>{{ data.autopilot.on ? tl('On', 'Actif') : tl('Off', 'Inactif') }}</span></h4>
          <template v-if="data.autopilot.on">
            <p>{{ words(data.autopilot.frequency) }}</p>
            <p class="scheduled-prompt">{{ data.autopilot.goal }}</p>
            <p>{{ tl('Today', 'Aujourd’hui') }} : {{ words(data.autopilot.today) }}</p>
            <p>{{ tl('Last wake', 'Dernier réveil') }} : {{ time(data.autopilot.last) }}</p>
            <p>{{ tl('Next wake', 'Prochain réveil') }} : {{ time(data.autopilot.next) }}</p>
          </template>
        </article>
        <article v-for="automation in data.automations" :key="automation.id">
          <h4>{{ automation.name }} <span>{{ automation.on ? tl('On', 'Active') : tl('Off', 'Inactive') }}</span></h4>
          <p>{{ trigger(automation.trigger) }}</p>
          <p>{{ tl('Last trigger', 'Dernier déclenchement') }} : {{ time(automation.last) }}</p>
          <p>{{ tl('Next trigger', 'Prochain déclenchement') }} : {{ time(automation.next) }}</p>
          <p class="scheduled-tasks"><a v-for="id in automation.tasks" :key="id" :href="taskLink(id)">{{ id }}</a></p>
        </article>
        <template v-if="data.timers.length">
          <p class="scheduled-session">{{ tl('Session: lost when the session closes', 'Session : perdus si la session se ferme') }}</p>
          <article v-for="timer in data.timers" :key="timer.id">
            <h4>{{ timer.id === WAKEUP_ID ? tl('Wakeup', 'Réveil') : timer.id }} <span>{{ timer.recurring ? tl('Recurring', 'Récurrent') : tl('Once', 'Ponctuel') }}</span></h4>
            <p v-if="timer.cron" class="scheduled-cron">{{ timer.cron }}</p>
            <p>{{ tl('Next run (estimated)', 'Prochaine exécution (estimée)') }} : {{ time(timer.next) }}</p>
            <p class="scheduled-prompt">{{ timer.prompt }}</p>
          </article>
        </template>
        <p v-if="!empty" class="scheduled-zone">{{ data.timezone }}</p>
      </template>
    </div>
  </details>
</template>

<style scoped>
.coordinator-scheduled { border-bottom: 1px solid var(--line); flex: 0 0 auto; min-width: 0; }
summary { cursor: pointer; padding: 8px 12px; font: 11px var(--mono); text-transform: uppercase; }
.scheduled-content { max-height: 38dvh; overflow: auto; overscroll-behavior: contain; padding: 0 12px 8px; font-size: 12px; }
article { border-top: 1px solid var(--line); padding: 7px 0; }
h4 { display: flex; gap: 8px; flex-wrap: wrap; font-weight: 600; }
h4 span, .scheduled-cron, .scheduled-zone, .scheduled-tasks { font: 10px var(--mono); }
p { margin: 3px 0; overflow-wrap: anywhere; }
h4 span, .scheduled-zone { color: var(--muted); }
.scheduled-prompt { white-space: pre-wrap; }
.scheduled-tasks { display: flex; flex-wrap: wrap; gap: 8px; text-decoration: underline; }
.scheduled-session { border-top: 1px solid var(--line); padding-top: 8px; color: var(--muted); }
</style>
