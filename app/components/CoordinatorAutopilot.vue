<script setup lang="ts">
// A coordinator's Autopilot switch: its state as herdr-projects reads it, and a
// sheet to turn it on (with its goal, frequency and limits) or off.
import type { CoordinatorTarget } from '#shared/projectsTasks'
import { autopilotId, type AutopilotDefaults, type AutopilotDetails, type AutopilotStatus } from '#shared/autopilot'
import { api } from '~/composables/useHerdr'
import { useAutopilot } from '~/composables/useAutopilot'
import { coordinatorLabel } from '~/utils/coordinators'

const props = defineProps<{ machine: string, to: CoordinatorTarget, disabled?: boolean, compact?: boolean }>()
const { machines, load, put } = useAutopilot()
const id = computed(() => autopilotId(props.to))
const here = computed(() => machines.value[props.machine])
// undefined: not read yet, or herdr-projects could not say.
const status = computed<AutopilotStatus | undefined>(() => {
  const s = here.value?.statuses
  return s ? s[id.value] ?? { on: false, goal: '', next: '', state: '', couldNot: '' } : undefined
})
const tooOld = computed(() => here.value?.code === 'projects_too_old')

const open = ref(false)
const busy = ref(false)
const reading = ref(false)
const error = ref('')
const goal = ref('')
const every = ref('')
const tasksPerDay = ref('')
const tasksAtOnce = ref('')
const defaults = ref<AutopilotDefaults>({ every: '', tasksPerDay: '', tasksAtOnce: '' })

const nextLabel = computed(() => {
  const next = status.value?.next || ''
  if (next.startsWith('next in ')) return tl(`Next wake in ${next.slice(8)}`, `Prochain réveil dans ${next.slice(8)}`)
  if (next === 'waits for its hours') return tl('Waiting for its active hours', 'En attente de ses heures actives')
  return next
})
const stateLabel = computed(() => !status.value ? '…' : status.value.on ? tl('On', 'Actif') : tl('Off', 'Arrêté'))
const title = computed(() => `Autopilot · ${coordinatorLabel(props.to, '')}`)
const hint = computed(() => [title.value, stateLabel.value, nextLabel.value].filter(Boolean).join(' · '))

const refresh = (force = false) => props.disabled ? Promise.resolve() : load(props.machine, force)

// The sheet reads the coordinator again: its real state, saved goal and defaults.
async function show() {
  open.value = true
  error.value = ''
  every.value = tasksPerDay.value = tasksAtOnce.value = ''
  goal.value = status.value?.goal || ''
  reading.value = true
  try {
    const d = await api<AutopilotDetails>(`/api/tasks/autopilot?${query()}`)
    take(d)
    goal.value = d.goal
  } catch (e) {
    error.value = (e as Error).message
    await refresh(true)
  } finally { reading.value = false }
}
function query() {
  return new URLSearchParams({ machine: props.machine, kind: props.to.kind, ...(props.to.kind === 'project' ? { repo: props.to.repo } : {}) })
}
function take(d: AutopilotDetails, acted = false) {
  const { defaults: dv, ...s } = d
  defaults.value = dv
  put(props.machine, id.value, s, acted)
}

const canSubmit = computed(() => !busy.value && !reading.value && Boolean(status.value) && (status.value!.on || Boolean(goal.value.trim())))
async function submit() {
  if (!canSubmit.value) return
  const on = !status.value!.on
  busy.value = true
  error.value = ''
  try {
    take(await api<AutopilotDetails>('/api/tasks/autopilot', {
      machine: props.machine, to: props.to, action: on ? 'on' : 'off',
      ...(on ? { goal: goal.value, every: every.value, tasksPerDay: tasksPerDay.value, tasksAtOnce: tasksAtOnce.value } : {}),
    }), true)
    open.value = false
  } catch (e) {
    // The board's own reason. The command may have run before a later read
    // failed: read the state again rather than assume it.
    error.value = (e as Error).message
    await refresh(true)
  } finally { busy.value = false }
}

watch(() => [props.machine, props.disabled], () => { void refresh() })
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void refresh()
  timer = setInterval(() => { if (!busy.value && !open.value && document.visibilityState === 'visible') void refresh() }, 60_000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <span v-if="!(compact && tooOld)" class="autopilot" :class="{ compact }">
    <button
      type="button" role="switch" class="autopilot-switch" :class="{ on: status?.on }" :aria-checked="status?.on ? 'true' : 'false'"
      :aria-label="title" :aria-description="hint" :title="hint" :disabled="disabled || busy" @click="show"
    >
      <i class="autopilot-dot" aria-hidden="true" />
      <span class="autopilot-name">Autopilot</span>
      <span v-if="!compact || status?.on" class="autopilot-state">{{ stateLabel }}</span>
      <span v-if="!compact && status?.on && nextLabel" class="autopilot-next">{{ nextLabel }}</span>
    </button>
    <AppSheet v-model:open="open" :title="title" top>
      <form class="sheet-form autopilot-form" @submit.prevent="submit">
        <p class="autopilot-now">
          <span class="field-label">{{ tl('State', 'État') }}</span>
          <b :class="{ on: status?.on }">{{ reading && !status ? '…' : stateLabel }}</b>
          <span v-if="status?.on && nextLabel"> · {{ nextLabel }}</span>
        </p>
        <p v-if="status?.couldNot" class="autopilot-could-not">{{ status.couldNot }}</p>

        <template v-if="status?.on">
          <template v-if="status.goal">
            <span class="field-label">{{ tl('Goal', 'Objectif') }}</span>
            <p class="autopilot-goal">{{ status.goal }}</p>
          </template>
          <p class="autopilot-ask">{{ tl('Stop Autopilot? The coordinator stays, it just is no longer woken up.', 'Arrêter Autopilot ? Le coordinateur reste là, il n’est simplement plus réveillé.') }}</p>
        </template>
        <template v-else-if="status">
          <label class="field-label" :for="`ap-goal-${id}`">{{ tl('Goal', 'Objectif') }}</label>
          <UTextarea
            :id="`ap-goal-${id}`" v-model="goal" :rows="3" autoresize :maxrows="8" size="xl" class="w-full" :maxlength="16000" :disabled="busy || reading"
            :placeholder="tl('What it works toward, e.g. Ship 2.1: the small fixes first', 'Ce vers quoi il travaille, ex. Sortir la 2.1 : les petites corrections d’abord')"
          />
          <div class="autopilot-limits">
            <div>
              <label class="field-label" :for="`ap-every-${id}`">{{ tl('Every', 'Fréquence') }} <span class="muted">{{ t('(optional)') }}</span></label>
              <UInput :id="`ap-every-${id}`" v-model="every" size="xl" class="w-full mono" :placeholder="defaults.every || '2h'" maxlength="20" autocapitalize="none" autocorrect="off" :spellcheck="false" :disabled="busy" />
            </div>
            <div>
              <label class="field-label" :for="`ap-day-${id}`">{{ tl('Tasks / day', 'Tâches / jour') }} <span class="muted">{{ t('(optional)') }}</span></label>
              <UInput :id="`ap-day-${id}`" v-model="tasksPerDay" size="xl" class="w-full mono" :placeholder="defaults.tasksPerDay" inputmode="numeric" maxlength="6" :disabled="busy" />
            </div>
            <div>
              <label class="field-label" :for="`ap-once-${id}`">{{ tl('At once', 'En parallèle') }} <span class="muted">{{ t('(optional)') }}</span></label>
              <UInput :id="`ap-once-${id}`" v-model="tasksAtOnce" size="xl" class="w-full mono" :placeholder="defaults.tasksAtOnce" inputmode="numeric" maxlength="6" :disabled="busy" />
            </div>
          </div>
          <p class="autopilot-note">{{ tl('Empty values keep the coordinator’s settings. Values given here are for this time only.', 'Les valeurs vides gardent les réglages du coordinateur. Celles données ici valent pour cette fois seulement.') }}</p>
        </template>
        <p v-if="error || (!status && here?.error)" class="form-error" role="alert">{{ error || here?.error }}</p>
        <button type="submit" hidden />
      </form>
      <template #footer>
        <div class="sheet-form autopilot-actions">
          <UButton
            v-if="status" block size="xl" class="sheet-btn" :color="status.on ? 'error' : 'primary'" :variant="status.on ? 'outline' : 'solid'"
            :icon="status.on ? 'i-lucide-square' : 'i-lucide-play'" :loading="busy" :disabled="!canSubmit" @click="submit"
          >
            {{ status.on ? tl('Stop Autopilot', 'Arrêter Autopilot') : tl('Turn on Autopilot', 'Activer Autopilot') }}
          </UButton>
          <UButton v-else block size="xl" color="neutral" variant="outline" class="sheet-btn" icon="i-lucide-refresh-cw" :loading="reading" @click="show">
            {{ tl('Retry', 'Réessayer') }}
          </UButton>
        </div>
      </template>
    </AppSheet>
  </span>
</template>

<style scoped>
.autopilot { display: inline-flex; min-width: 0; max-width: 100%; }
.autopilot-switch {
  display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-height: 32px; max-width: 100%; padding: 6px 10px;
  border: 1px solid var(--line); border-radius: 0; background: transparent; color: var(--muted); cursor: pointer;
  font: 600 10.5px/1.1 var(--mono); letter-spacing: .1em; text-transform: uppercase; text-align: left;
}
.autopilot-switch:hover:not(:disabled) { color: var(--text); border-color: var(--line-strong); }
.autopilot-switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.autopilot-switch:disabled { opacity: .5; cursor: default; }
.autopilot-switch.on { color: var(--text); border-color: color-mix(in srgb, var(--green) 55%, var(--line)); }
.autopilot-dot { flex: none; width: 8px; height: 8px; border: 1px solid currentColor; }
.autopilot-switch.on .autopilot-dot { background: var(--green); border-color: var(--green); }
.autopilot-state { color: var(--text-3); }
.autopilot-switch.on .autopilot-state { color: var(--green); }
.autopilot-next { flex-basis: 100%; padding-left: 16px; color: var(--muted); letter-spacing: .04em; text-transform: none; font-weight: 500; }
.compact .autopilot-switch { min-height: 0; height: 28px; padding: 0 8px; flex-wrap: nowrap; }
.autopilot-now { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: 6px 2px 0; font: 500 13px/1.4 var(--mono); color: var(--muted); }
.autopilot-now .field-label { margin: 0 6px 0 0; }
.autopilot-now b { color: var(--text); text-transform: uppercase; letter-spacing: .1em; }
.autopilot-now b.on { color: var(--green); }
.autopilot-could-not { margin: 10px 2px 0; padding: 8px 10px; border-left: 2px solid var(--ochre); background: var(--surface-2); font-size: 13px; color: var(--text-2); }
.autopilot-goal { margin: 0 2px; padding: 10px 12px; border: 1px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; color: var(--text-2); }
.autopilot-ask { margin: 18px 2px 0; font-size: 14px; color: var(--text); }
.autopilot-limits { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 8px; }
.autopilot-note { margin: 10px 2px 0; font-size: 12.5px; color: var(--muted); }
</style>
