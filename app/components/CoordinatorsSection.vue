<script setup lang="ts">
// The COORDINATORS section under Alfred (AlfredRow, the main coordinator) at
// the top of the agent list: the project coordinators that run. One tap opens
// its conversation. Hidden while project management is off.
import type { CoordinatorView } from '#shared/pm/coordinator'

const busy = ref('')
const error = ref('')
const rows = computed(() => coordinators.value.filter(c => !c.main && coordinatorPane(c)))

async function open(c: CoordinatorView) {
  if (busy.value) return
  busy.value = c.project
  error.value = ''
  try { await openCoordinator(c) }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = '' }
}

const name = (c: CoordinatorView) => tl(`${c.project} coordinator`, `Coordinateur ${c.project}`)
const sub = (c: CoordinatorView) => {
  const p = coordinatorPane(c)
  const program = kindLabel((c.ran ?? coordinatorAgent(c))?.program)
  if (p) return `${program} · ${statusLabel(p)}`
  return tl(`Start with ${program}`, `Lancer avec ${program}`)
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { loadCoordinators(); timer = setInterval(loadCoordinators, 30_000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section v-if="rows.length" class="agent-group coord-list" data-testid="coordinators">
    <h2 class="group-title"><span>{{ tl('Coordinators', 'Coordinateurs') }}</span><span class="count">{{ rows.length }}</span></h2>
    <button
      v-for="c in rows" :key="c.project" type="button" class="coord-row" :class="{ on: !!coordinatorPane(c) }"
      :disabled="!!busy" data-testid="coordinator-row" @click="open(c)"
    >
      <i class="coord-dot" aria-hidden="true" />
      <span class="coord-text"><b>{{ name(c) }}</b><small>{{ busy === c.project ? tl('Starting…', 'Lancement…') : sub(c) }}</small></span>
      <UIcon :name="coordinatorPane(c) ? 'i-lucide-chevron-right' : 'i-lucide-play'" class="coord-go" />
    </button>
    <p v-if="error" class="error coord-error">{{ error }}</p>
  </section>
</template>

<style scoped>
.coord-list { display: grid; }
.coord-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px 12px; border: 1px solid var(--line); border-top-width: 0; background: var(--surface); color: var(--text); text-align: left; cursor: pointer; }
.coord-row:first-of-type { border-top-width: 1px; }
.coord-row:hover:not(:disabled) { background: var(--surface-2); }
.coord-row:disabled { cursor: progress; }
.coord-row:focus-visible { outline: 1px solid var(--mauve); outline-offset: -1px; }
.coord-dot { flex: none; width: 8px; height: 8px; background: var(--dim); }
.coord-row.on .coord-dot { background: var(--green); }
.coord-text { display: grid; flex: 1; min-width: 0; }
.coord-text b { font: 600 14px/1.3 var(--display); }
.coord-text small { overflow: hidden; color: var(--muted); font: 12px/1.4 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.coord-go { flex: none; color: var(--dim); }
.coord-error { margin: 6px 0 0; }
</style>
