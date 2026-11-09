<script setup lang="ts">
// The project sheet's Machines block (General tab): the machines its tasks may
// run on. Home is the project's own (read only); each other one has its clone
// of the repo, and is added (among herdr-core's connected machines) or removed
// through project-update. After an add, that machine's readiness check runs
// (project-machine-check) and its result shows under it. Placement: how its
// tasks spread over these machines (shared/pm/placement.ts), saved at once.
import { allowedMachines, type Project } from '#shared/pm/project'
import { STRATEGIES, STRATEGY_LABELS, type Strategy } from '#shared/pm/placement'

const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ changed: [] }>()
const p = computed(() => props.project)

const labelOf = (key: string) => machines.value.find(m => m.key === key)?.label ?? (key || tl('This machine'))
const others = computed(() => allowedMachines(p.value).slice(1))
const addable = computed(() => machines.value
  .filter(m => !m.session && (m.local || m.status === 'online') && !allowedMachines(p.value).includes(m.key))
  .map(m => ({ label: m.label, value: m.key })))

const form = reactive({ machine: '', clone: '' })
const busy = ref('')
const error = ref('')
// Each machine's last check here: checking, or its failures ('' ready).
const checks = reactive<Record<string, { checking: true } | { refused: string }>>({})

const save = (machines: string[], clones: Record<string, string> = {}) => api('/api/pm/project-update', { key: p.value.key, machines, clones })
async function run(what: string, fn: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = what
  error.value = ''
  try { await fn() }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = '' }
}
const add = () => run('add', async () => {
  const k = form.machine
  await save([...others.value, k], { [k]: form.clone.trim() })
  Object.assign(form, { machine: '', clone: '' })
  emit('changed')
  checks[k] = { checking: true }
  try { checks[k] = { refused: (await api<{ refused?: string }>('/api/pm/project-machine-check', { key: p.value.key, machine: k })).refused ?? '' } }
  catch (e) { checks[k] = { refused: (e as Error).message } }
})
const strategies = STRATEGIES.map(s => ({ label: tl(STRATEGY_LABELS[s]), value: s }))
const strategy = computed({
  get: () => p.value.placement ?? 'strongest',
  set: (placement: Strategy) => run('placement', async () => {
    await api('/api/pm/project-update', { key: p.value.key, placement })
    emit('changed')
  }),
})
const remove = (k: string) => run(`rm:${k}`, async () => {
  await save(others.value.filter(x => x !== k))
  delete checks[k]
  emit('changed')
})
</script>

<template>
  <div class="pm-machines" data-testid="pm-machines">
    <div class="pm-machine">
      <span>{{ labelOf(p.machine) }} <small class="mono-label">{{ tl('Home') }}</small></span>
      <small class="pm-clone">{{ ltr(shortPath(p.path)) }}</small>
    </div>
    <div v-for="k in others" :key="k" class="pm-machine" data-testid="pm-machine">
      <span>{{ labelOf(k) }}</span>
      <small class="pm-clone">{{ ltr(p.clones?.[k] ?? '') }}</small>
      <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-x" :aria-label="tl(`Remove ${labelOf(k)}`)" :loading="busy === `rm:${k}`" :disabled="busy !== ''" data-testid="pm-machine-remove" @click="remove(k)" />
      <small v-if="checks[k]" class="pm-ready" :class="{ bad: 'refused' in checks[k]! && checks[k]!.refused }" data-testid="pm-machine-ready">
        {{ 'checking' in checks[k]! ? tl('Checking…') : checks[k]!.refused ? tl(`Not ready: ${checks[k]!.refused}`) : tl('Ready') }}
      </small>
    </div>
    <form class="pm-machine-add" @submit.prevent="add">
      <USelect v-model="form.machine" :items="addable" size="lg" :placeholder="tl('Add a machine')" :aria-label="tl('Machine to add')" data-testid="pm-machine-pick" />
      <UInput v-model="form.clone" size="lg" class="mono" placeholder="~/project" :aria-label="tl('Clone path on that machine')" maxlength="500" autocomplete="off" data-testid="pm-machine-clone" />
      <UButton type="submit" size="lg" color="neutral" variant="soft" :loading="busy === 'add'" :disabled="!form.machine || !form.clone.trim() || busy !== ''" data-testid="pm-machine-add">{{ tl('Add') }}</UButton>
    </form>
    <small class="muted">{{ tl('Tasks may start on these machines, each in its own clone of the repository.') }}</small>
    <label class="pm-placement">
      <span>{{ tl('Placement') }}</span>
      <USelect v-model="strategy" :items="strategies" size="lg" :disabled="busy !== ''" :aria-label="tl('Placement strategy')" data-testid="pm-placement" />
    </label>
    <small class="muted">{{ tl('Heavy to the strongest: light work at home, heavy work on the machine with most room. Balance the load: each task on the machine with most room left. Home first: other machines only once home is full.') }}</small>
    <p v-if="error" class="form-error" role="alert">{{ t(error) }}</p>
  </div>
</template>

<style scoped>
.pm-machines { display: grid; gap: 8px; }
.pm-machine { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto; align-items: center; gap: 4px 10px; }
.pm-clone { color: var(--muted); font-family: var(--font-mono, 'JetBrains Mono', monospace); font-size: 12px; overflow-wrap: anywhere; }
.pm-ready { grid-column: 1 / -1; color: var(--muted); overflow-wrap: anywhere; }
.pm-ready.bad { color: var(--blocked); }
.pm-placement { display: flex; align-items: center; gap: 10px; }
.pm-machine-add { display: grid; grid-template-columns: minmax(0, 160px) minmax(0, 1fr) auto; gap: 8px; }
@media (max-width: 520px) { .pm-machine-add { grid-template-columns: minmax(0, 1fr) auto; } .pm-machine-add > :nth-child(2) { grid-column: 1 / -1; grid-row: 2; } }
</style>
