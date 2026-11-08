<script setup lang="ts">
// A task's sheet: its Plan (the steps, the current one, what its holder was
// told, the proofs and rounds), its links, the agent holding the step, and
// the step's button when it waits for the user ("Merged"), Stop (with its
// reason, confirmed here), how a stopped task goes on, and Delete for a task
// never started (confirmed). Those stay at the top; below, tabs (the app's
// segmented style) for the rest, only the open one scrolling: Description (the
// text, tags and links, the PR among them), Plan (each step with its
// screenshots), Log.
import { canStop, type Card } from '#shared/pm/board'
import { RESUMES, type Resume } from '#shared/pm/stop'
import type { Pane } from '#shared/types'
import { shotMode } from '#shared/pm/shots'

// stopping: opened from the card menu's Stop, the confirmation shown.
const props = defineProps<{ card: Card, pane?: Pane, stopping?: boolean }>()
const emit = defineEmits<{ closed: [], changed: [] }>()
const open = ref(true)
const busy = ref(false)
const error = ref('')

const at = computed(() => (props.card.state?.started ? props.card.state.at : -1))
const done = computed(() => !!props.card.state?.done)
const proofs = (id: string) => Object.entries(props.card.state?.proofs[id] ?? {}).filter(([, v]) => v)
const rounds = (id: string) => props.card.state?.rounds[id] ?? 0
// The steps that have screenshots, to look at before the push, the PR or the merge.
const shots = (id: string) => props.card.state?.shots?.[id] ?? []

type Tab = 'description' | 'plan' | 'log'
const TAB_LABEL: Record<Tab, [string, string]> = { description: ['Description', 'Description'], plan: ['Plan', 'Plan'], log: ['Log', 'Journal'] }
const tabs = computed<Tab[]>(() => [
  ...(props.card.description || props.card.tags.length || props.card.links.length ? ['description' as const] : []),
  'plan',
  ...(props.card.log.length ? ['log' as const] : []),
])
const picked = ref<Tab>()
// The tab picked while it is still there (the task read again), else the first.
const tab = computed(() => (picked.value && tabs.value.includes(picked.value) ? picked.value : tabs.value[0]!))

async function run(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try { if (await fn() !== false) emit('changed') }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
const press = () => run(() => api('/api/pm/step-user', { id: props.card.id }))
const confirmStop = ref(!!props.stopping)
const why = ref('')
const stop = () => run(async () => { await stopTaskApi(props.card.id, why.value); confirmStop.value = false })
const resume = (how: Resume) => run(() => resumeTaskApi(props.card.id, how))
// Removed: the sheet closes, the board reloads without it.
const remove = () => run(async () => { const yes = await removeTaskApi(props.card.id); if (yes) open.value = false; return yes })
</script>

<template>
  <AppSheet v-model:open="open" :title="card.title" tall hide-close @closed="emit('closed')">
    <div class="task-sheet" data-testid="task-sheet">
      <div class="task-sheet-top">
        <p class="mono-label">{{ card.id }}<template v-if="card.step"> · {{ card.step }}</template></p>
        <p v-if="card.yourTurn" class="board-badge">{{ card.yourTurn }}</p>
        <div class="task-sheet-actions">
          <UButton v-if="card.userLabel && !card.stopped" color="primary" size="xl" :loading="busy" data-testid="step-user" @click="press">{{ card.userLabel }}</UButton>
          <UButton v-for="how in card.stopped ? RESUMES : []" :key="how" size="xl" :color="how === 'continue' ? 'primary' : 'neutral'" :variant="how === 'continue' ? 'solid' : 'outline'"
            :disabled="busy" :data-resume="how" @click="resume(how)">{{ tl(...RESUME_LABEL[how]) }}</UButton>
          <UButton v-if="pane" color="neutral" variant="outline" size="xl" icon="i-lucide-terminal" :to="panePath(pane.id)">
            {{ card.holder === 'reviewer' ? tl('Open the reviewer', 'Ouvrir le relecteur') : tl('Open the agent', 'Ouvrir l’agent') }}
          </UButton>
          <UButton v-if="canStop(card) && !confirmStop" color="error" variant="outline" size="xl" icon="i-lucide-square" data-testid="task-stop" @click="confirmStop = true">{{ tl('Stop', 'Arrêter') }}</UButton>
          <UButton v-if="card.removable" color="error" variant="outline" size="xl" icon="i-lucide-trash-2" :loading="busy" data-testid="task-remove" @click="remove">{{ tl('Delete…', 'Supprimer…') }}</UButton>
        </div>
        <form v-if="canStop(card) && confirmStop" class="task-stop-confirm" data-testid="task-stop-confirm" @submit.prevent="stop">
          <p>{{ tl('Stop this task? Its agent ends; the worktree, branch and work stay, and nothing is merged.', 'Arrêter cette tâche ? Son agent s’arrête ; le worktree, la branche et le travail restent, rien n’est fusionné.') }}</p>
          <UInput v-model="why" size="xl" maxlength="300" :placeholder="tl('Why (optional)', 'Pourquoi (facultatif)')" data-testid="task-stop-why" />
          <div class="task-sheet-actions">
            <UButton type="submit" color="error" size="xl" :loading="busy" data-testid="task-stop-yes">{{ tl('Stop the task', 'Arrêter la tâche') }}</UButton>
            <UButton color="neutral" variant="outline" size="xl" :disabled="busy" @click="confirmStop = false">{{ t('Cancel') }}</UButton>
          </div>
        </form>
        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <div class="segmented task-tabs" role="tablist" :style="{ '--segment-count': tabs.length }">
        <button v-for="k in tabs" :id="`task-tab-${k}`" :key="k" type="button" role="tab" :class="{ on: tab === k }" :aria-selected="tab === k" :aria-controls="tab === k ? 'task-panel' : undefined" :data-tab="k" @click="picked = k">
          <span>{{ tl(...TAB_LABEL[k]) }}</span>
        </button>
      </div>

      <div id="task-panel" class="task-panel" role="tabpanel" :aria-labelledby="`task-tab-${tab}`" data-testid="task-panel">
        <template v-if="tab === 'description'">
          <p v-if="card.description" class="task-desc">{{ card.description }}</p>
          <div v-if="card.tags.length || card.links.length" class="board-tags">
            <span v-for="tag in card.tags" :key="tag" class="board-chip">{{ tag }}</span>
            <a v-for="l in card.links" :key="l.url" :href="l.url" target="_blank" rel="noopener" class="board-chip">{{ l.label }}</a>
          </div>
        </template>

        <ol v-else-if="tab === 'plan'" class="task-plan" data-testid="task-plan">
          <li v-for="(s, i) in card.plan" :key="s.id" :class="{ now: i === at && !done, past: i < at || done }" :aria-current="i === at && !done ? 'step' : undefined">
            <span class="mono-label">{{ s.id }} · {{ s.column || s.id }}<template v-if="s.holder && s.holder !== 'none'"> · {{ s.holder }}</template><template v-if="rounds(s.id)"> · {{ tl(`${rounds(s.id)} send-backs`, `${rounds(s.id)} renvois`) }}</template></span>
            <details v-if="s.text && s.holder && s.holder !== 'none'">
              <summary>{{ tl('Instructions', 'Consignes') }}</summary>
              <p class="task-desc">{{ s.text }}</p>
            </details>
            <small v-for="[k, v] in proofs(s.id)" :key="k" class="muted">{{ k }}: <a v-if="/^https?:\/\//.test(v)" :href="v" target="_blank" rel="noopener">{{ v }}</a><template v-else>{{ v }}</template></small>
            <TaskShots v-if="shots(s.id).length" :task="card.id" :shots="shots(s.id)" :mode="shotMode(s)" />
          </li>
        </ol>

        <ol v-else class="task-log" data-testid="task-log">
          <li v-for="(e, i) in [...card.log].reverse()" :key="i">
            <span class="mono-label muted">{{ new Date(e.at).toLocaleString() }} · {{ e.by }}</span>
            <span class="task-desc">{{ e.text }}</span>
          </li>
        </ol>
      </div>
    </div>
  </AppSheet>
</template>

<style scoped>
/* The whole sheet's height: the top stays, only the tab's panel scrolls. */
.task-sheet { display: flex; flex-direction: column; gap: 12px; height: 100%; padding: 0 16px 16px; }
.task-sheet-top { display: flex; flex-direction: column; gap: 10px; flex: none; }
.task-sheet p { margin: 0; }
.task-tabs { flex: none; }
.task-panel { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 120px; overflow-y: auto; overscroll-behavior: contain; }
.task-desc { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }
.task-sheet-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.task-sheet-actions:empty { display: none; }
.task-stop-confirm { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--danger); }
.task-plan { list-style: none; margin: 0; padding: 0; }
.task-plan li { display: flex; flex-direction: column; gap: 4px; padding: 8px 0 8px 12px; border-bottom: 1px solid var(--line-soft); border-left: 2px solid transparent; }
.task-plan li.past { color: var(--muted); }
.task-plan li.now { border-left-color: var(--accent); }
.task-log { list-style: none; margin: 0; padding: 0; }
.task-log li { display: grid; gap: 2px; padding: 6px 0; border-bottom: 1px solid var(--line-soft); }
.task-plan summary { cursor: pointer; min-height: 32px; display: flex; align-items: center; }
</style>
