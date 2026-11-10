<script setup lang="ts">
// A task's sheet. A task waiting for the user opens on To do (TaskTodo): what
// it needs from them and its buttons. Otherwise: its Plan (the steps, the current one, what its holder was
// told, the proofs and rounds), its links, the agent holding the step, and
// the step's button when it waits for the user ("Merged"; busy while it runs, a
// refused action said in plain words under it), Start for a task to do (or
// the tasks it waits for; a refusal said under it), Stop (with its
// reason, confirmed here), how a stopped task goes on, Check on GitHub for a
// task at its merge step or archived with a PR (what it found said under the
// buttons, with the PR and, for a PR closed unmerged, Archive), and Delete for
// a task never started (confirmed), Unarchive for an archived one. Those stay at the top; below, tabs (the app's
// segmented style) for the rest, in the sheet's one scroll: Description (the
// text in Markdown, the chat's safe renderer, no raw HTML; tags and links, the PR among them), Plan (each step with its
// screenshots), History (the hand-offs between its agents and the user,
// TaskHistory), Log (the raw lines).
import { canStart, canStop, cardStatus, linkLabel, mergeWaits, statusText, type Card } from '#shared/pm/board'
import { canCheckGithub, type GhCheck } from '#shared/pm/ghCheck'
import type { Resume } from '#shared/pm/stop'
import type { Pane } from '#shared/types'
import { reviewSwitch, type Task } from '#shared/pm/run'
import { shotMode } from '#shared/pm/shots'
import { timesText } from '#shared/pm/times'
import type { Choice } from '#shared/pm/verdict'

// stopping: opened from the card menu's Stop, the confirmation shown.
// reporting: opened from its Report a problem, the form shown (TaskReport).
// checking: opened from the card menu's Check on GitHub, the check run at once.
const props = defineProps<{ card: Card, pane?: Pane, stopping?: boolean, reporting?: boolean, checking?: boolean, waitsFor?: string[] }>()
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
// The sets a rework after the review replaced.
const earlier = (id: string) => props.card.state?.earlierShots?.[id] ?? []
// The fallback took the last review (the review agent out of quota): said on the review step it holds now or held last.
const switched = computed(() => reviewSwitch(props.card.log))
const switchAt = computed(() => props.card.plan.findLastIndex((s, i) => s.holder === 'reviewer' && (done.value || i <= at.value)))
// Where its PR and merge stand (the card's line), with the full time and the approval's date.
const status = computed(() => { const s = cardStatus(props.card); return s && { ...s, text: statusText(s, fmtDateTime, true) } })

// Time per step, the waits for the user apart, review rounds and CI fixes, in one line.
const times = computed(() => (props.card.times ? timesText(props.card.times) : ''))

const todo = computed(() => taskTodo(props.card))
const descHtml = computed(() => (props.card.description ? md(props.card.description, { plain: true }) : ''))
function onDescClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest?.('.code-copy') as HTMLElement | null
  const text = btn?.closest('.code-block')?.querySelector('pre')?.textContent
  if (btn && text != null) copyCodeBlock(btn, text)
}
type Tab = 'todo' | 'description' | 'plan' | 'history' | 'log'
const TAB_LABEL: Record<Tab, [string, string?]> = { todo: ['To do', 'À faire'], description: ['Description', 'Description'], plan: ['Plan', 'Plan'], history: ['History'], log: ['Log', 'Journal'] }
const tabs = computed<Tab[]>(() => [
  ...(todo.value ? ['todo' as const] : []),
  ...(props.card.description || props.card.specNotes?.length || props.card.tags.length || props.card.links.length ? ['description' as const] : []),
  'plan',
  ...(props.card.log.length ? ['history' as const, 'log' as const] : []),
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
// The step's action refused (a merge on a PR in conflict, with red checks…):
// its badge, said under the button until the step's badge changes.
const pressing = ref(false)
const refused = ref('')
const press = () => run(async () => {
  pressing.value = true
  refused.value = ''
  try {
    const { task } = await api<{ task: Task }>('/api/pm/step-user', { id: props.card.id })
    if (task.step?.yourTurn?.reason === 'action') refused.value = task.step.yourTurn.badge
  }
  finally { pressing.value = false }
})
watch(() => props.card.yourTurn, (b) => { if (b !== refused.value) refused.value = '' })
const confirmStop = ref(!!props.stopping)
const why = ref('')
const stop = () => run(async () => { await stopTaskApi(props.card.id, why.value); confirmStop.value = false })
const start = () => run(() => startTaskApi(props.card.id, undefined, props.card.sameFiles ? true : undefined))
const resume = (how: Resume) => run(() => resumeTaskApi(props.card.id, how))
const decide = (choice: Choice) => run(() => api('/api/pm/decide', { id: props.card.id, choice }))
const sendBack = (note: string) => run(() => api('/api/pm/step-back', { id: props.card.id, note }))
// A problem reported to the coordinator: open on the card until it acts or the user withdraws it.
const reportOpen = ref(!!props.reporting)
// An action step that failed (a merge refused): the user runs it again.
// Not an approved merge on its way: a refusal the queue tries again is not the user's (mergeWaits).
const failedAction = computed(() => { const s = props.card.state; return !props.card.stopped && !!s && !s.acting && s.yourTurn?.reason === 'action' && !!props.card.plan[s.at]?.action && mergeWaits(props.card) === undefined })
const canReport = computed(() => !!props.card.yourTurn && !props.card.state?.done && !props.card.report)
const report = (r: { text: string, shots: string[], block: boolean }) => run(async () => { await api('/api/pm/report', { id: props.card.id, ...r }); reportOpen.value = false })
const withdraw = () => run(() => api('/api/pm/report', { id: props.card.id, withdraw: true }))
const check = ref<GhCheck>()
const checkGithub = () => run(async () => { check.value = (await api<{ check: GhCheck }>('/api/pm/task-check', { id: props.card.id })).check })
const archiveClosed = () => run(async () => { const yes = await archiveClosedApi(props.card.id, !!props.card.stopped); if (yes) check.value = undefined; return yes })
onMounted(() => { if (props.checking) checkGithub() })
// Archived (off the board, done for its project's delay): back in Done.
const unarchive = () => run(() => api('/api/pm/task-unarchive', { id: props.card.id }))
// Removed: the sheet closes, the board reloads without it.
const remove = () => run(async () => { const yes = await removeTaskApi(props.card.id); if (yes) open.value = false; return yes })
</script>

<template>
  <AppSheet v-model:open="open" :title="card.title" tall hide-close @closed="emit('closed')">
    <template #lead><ProjectBadge :text="card.shown" :color="card.color" copy /></template>
    <div class="task-sheet" data-testid="task-sheet">
      <div class="task-sheet-top">
        <p v-if="card.step" class="mono-label">{{ card.step }}</p>
        <p v-if="status" class="task-status" :class="status.tone" data-testid="task-status">{{ status.text }}</p>
        <p v-if="times" class="task-times" data-testid="task-times">{{ times }}</p>
        <p v-if="card.archived" class="muted" data-testid="task-archived">{{ tl('Archived') }} {{ fmtWhen(new Date(card.archived).toISOString()) }}</p>
        <div class="task-sheet-actions">
          <UButton v-if="!todo && canStart(card) && !waitsFor?.length" color="primary" size="xl" icon="i-lucide-play" :loading="busy" data-testid="task-start" @click="start">{{ card.sameFiles ? tl('Start anyway') : tl('Start', 'Lancer') }}</UButton>
          <UButton v-if="!todo && pane" color="neutral" variant="outline" size="xl" icon="i-lucide-terminal" :to="panePath(pane.id)">
            {{ card.holder === 'reviewer' ? tl('Open the reviewer', 'Ouvrir le relecteur') : tl('Open the agent', 'Ouvrir l’agent') }}
          </UButton>
          <UButton v-if="failedAction" color="primary" size="xl" icon="i-lucide-rotate-ccw" :loading="busy" data-testid="task-retry" @click="press">{{ tl('Try again', 'Réessayer') }}</UButton>
          <UButton v-if="canReport && !reportOpen" color="neutral" variant="outline" size="xl" icon="i-lucide-flag" data-testid="task-report-start" @click="reportOpen = true">{{ tl('Report a problem') }}</UButton>
          <UButton v-if="canStop(card) && !confirmStop" color="error" variant="outline" size="xl" icon="i-lucide-square" data-testid="task-stop" @click="confirmStop = true">{{ tl('Stop', 'Arrêter') }}</UButton>
          <UButton v-if="canCheckGithub(card)" color="neutral" variant="outline" size="xl" icon="i-lucide-refresh-cw" :loading="busy" data-testid="task-check" @click="checkGithub">{{ tl('Check on GitHub') }}</UButton>
          <UButton v-if="card.archived" color="neutral" variant="outline" size="xl" icon="i-lucide-archive-restore" :loading="busy" data-testid="task-unarchive" @click="unarchive">{{ tl('Unarchive') }}</UButton>
          <UButton v-if="card.removable" color="error" variant="outline" size="xl" icon="i-lucide-trash-2" :loading="busy" data-testid="task-remove" @click="remove">{{ tl('Delete…', 'Supprimer…') }}</UButton>
        </div>
        <p v-if="canStart(card) && waitsFor?.length" class="muted" data-testid="task-waits">{{ tl(`Starts once ${waitsFor.join(', ')} ${waitsFor.length > 1 ? 'are' : 'is'} done.`, `Démarre une fois ${waitsFor.join(', ')} terminée${waitsFor.length > 1 ? 's' : ''}.`) }}</p>
        <form v-if="canStop(card) && confirmStop" class="task-stop-confirm" data-testid="task-stop-confirm" @submit.prevent="stop">
          <p>{{ tl('Stop this task? Its agent ends; the worktree, branch and work stay, and nothing is merged.', 'Arrêter cette tâche ? Son agent s’arrête ; le worktree, la branche et le travail restent, rien n’est fusionné.') }}</p>
          <UInput v-model="why" size="xl" maxlength="300" :placeholder="tl('Why (optional)', 'Pourquoi (facultatif)')" data-testid="task-stop-why" />
          <div class="task-sheet-actions">
            <UButton type="submit" color="error" size="xl" :loading="busy" data-testid="task-stop-yes">{{ tl('Stop the task', 'Arrêter la tâche') }}</UButton>
            <UButton color="neutral" variant="outline" size="xl" :disabled="busy" @click="confirmStop = false">{{ t('Cancel') }}</UButton>
          </div>
        </form>
        <TaskReport v-if="canReport && reportOpen" :card="card" :busy="busy" @send="report" @cancel="reportOpen = false" />
        <div v-if="card.report" class="task-report-open" data-testid="task-report-open">
          <p><b>{{ tl('Problem reported') }} {{ fmtTime(card.report.at) }}</b><template v-if="card.report.block"> · {{ tl('merge blocked') }}</template></p>
          <p class="task-desc">{{ card.report.text }}</p>
          <UButton color="neutral" variant="outline" size="xl" :loading="busy" data-testid="task-report-withdraw" @click="withdraw">{{ tl('Withdraw') }}</UButton>
        </div>
        <div v-if="check" class="task-check" role="status" :data-outcome="check.outcome" data-testid="task-check-result">
          <p class="task-status" :class="{ merged: 'ok', open: 'wait', closed: 'bad' }[check.outcome]">{{ check.text }}</p>
          <div class="task-sheet-actions">
            <UButton color="neutral" variant="ghost" size="xl" icon="i-lucide-square-arrow-out-up-right" :to="check.url" target="_blank">{{ tl('Open the PR') }}</UButton>
            <UButton v-if="check.archive" color="error" variant="outline" size="xl" icon="i-lucide-archive" :loading="busy" data-testid="task-check-archive" @click="archiveClosed">{{ tl('Archive…') }}</UButton>
          </div>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <div class="segmented task-tabs" role="tablist" :style="{ '--segment-count': tabs.length }">
        <button v-for="k in tabs" :id="`task-tab-${k}`" :key="k" type="button" role="tab" :class="{ on: tab === k }" :aria-selected="tab === k" :aria-controls="tab === k ? 'task-panel' : undefined" :data-tab="k" @click="picked = k">
          <span>{{ tl(...TAB_LABEL[k]) }}</span>
        </button>
      </div>

      <div id="task-panel" class="task-panel" role="tabpanel" :aria-labelledby="`task-tab-${tab}`" data-testid="task-panel">
        <TaskTodo v-if="tab === 'todo' && todo" :card="card" :kind="todo" :pane="pane" :busy="busy" :pressing="pressing" :refused="refused" :waits-for="waitsFor"
          @press="press" @start="start" @resume="resume" @decide="decide" @back="sendBack" />
        <template v-else-if="tab === 'description'">
          <!-- eslint-disable-next-line vue/no-v-html -- HTML sanitized by DOMPurify (utils/markdown.ts) -->
          <div v-if="descHtml" class="md-body task-md" data-testid="task-description" @click="onDescClick" v-html="descHtml" />
          <section v-if="card.specNotes?.length" class="task-spec-notes" data-testid="task-spec-notes">
            <span class="mono-label">{{ tl('Spec changes · the latest overrides the description') }}</span>
            <p v-for="n in card.specNotes" :key="n.at" class="task-spec-note"><span class="mono-label">{{ fmtDateTime(n.at) }}</span> {{ n.text }}</p>
          </section>
          <div v-if="card.tags.length || card.links.length" class="board-tags">
            <span v-for="tag in card.tags" :key="tag" class="board-chip">{{ tag }}</span>
            <a v-for="l in card.links" :key="l.url" :href="l.url" target="_blank" rel="noopener" class="board-chip">{{ linkLabel(l) }}</a>
          </div>
        </template>

        <ol v-else-if="tab === 'plan'" class="task-plan" data-testid="task-plan">
          <li v-for="(s, i) in card.plan" :key="s.id" :class="{ now: i === at && !done, past: i < at || done }" :aria-current="i === at && !done ? 'step' : undefined">
            <span class="mono-label">{{ s.id }} · {{ s.column || s.id }}<template v-if="s.holder && s.holder !== 'none'"> · {{ s.holder }}</template><template v-if="rounds(s.id)"> · {{ tl(`${rounds(s.id)} send-backs`, `${rounds(s.id)} renvois`) }}</template></span>
            <details v-if="s.text && s.holder && s.holder !== 'none'">
              <summary>{{ tl('Instructions', 'Consignes') }}</summary>
              <p class="task-desc">{{ s.text }}</p>
            </details>
            <small v-if="switched && i === switchAt" class="muted" data-testid="review-switch">{{ switched }}</small>
            <small v-for="[k, v] in proofs(s.id)" :key="k" class="muted">{{ k }}: <a v-if="/^https?:\/\//.test(v)" :href="v" target="_blank" rel="noopener">{{ v }}</a><template v-else>{{ v }}</template></small>
            <TaskShots v-if="shots(s.id).length" :task="card.id" :shots="shots(s.id)" :mode="shotMode(s)" />
            <details v-if="earlier(s.id).length" data-testid="shots-earlier">
              <summary>{{ tl('Earlier screenshots') }}</summary>
              <TaskShots :task="card.id" :shots="earlier(s.id)" :mode="shotMode(s)" />
            </details>
          </li>
        </ol>

        <TaskHistory v-else-if="tab === 'history'" :card="card" />

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
/* One scroll, the sheet's body (a flex column, main.css): the sheet fills it
   and grows with its tab, whose panel takes its natural height. */
.task-sheet { display: flex; flex-direction: column; gap: 12px; flex: 1 0 auto; padding: 0 16px 16px; }
.task-sheet-top { display: flex; flex-direction: column; gap: 10px; flex: none; }
.task-sheet p { margin: 0; }
.task-tabs { flex: none; }
.task-status { font-size: 13px; overflow-wrap: anywhere; color: var(--muted); }
.task-status.wait { color: var(--working); }
.task-status.bad { color: var(--danger); }
.task-status.ok { color: var(--done); }
.task-check { display: grid; gap: 4px; }
.task-times { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.task-panel { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.task-desc { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }
/* Headings shown small: a description is not a document. */
.task-md { flex: none; overflow-wrap: anywhere; color: var(--text-2); }
.task-md :deep(:is(h1, h2, h3, h4, h5, h6)) { font-size: 15px; margin: 1em 0 .4em; }
.task-sheet .task-md :deep(p) { margin: 0 0 .75em; }
.task-spec-notes { display: grid; gap: 6px; }
.task-spec-note { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; color: var(--text-2); }
.task-sheet-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.task-sheet-actions:empty { display: none; }
.task-report-open { display: grid; gap: 6px; justify-items: start; padding: 10px 12px; border: 1px solid var(--working); }
.task-stop-confirm { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--danger); }
.task-plan { list-style: none; margin: 0; padding: 0; }
.task-plan li { display: flex; flex-direction: column; gap: 4px; padding: 8px 0 8px 12px; border-bottom: 1px solid var(--line-soft); border-left: 2px solid transparent; }
.task-plan li.past { color: var(--muted); }
.task-plan li.now { border-left-color: var(--accent); }
.task-log { list-style: none; margin: 0; padding: 0; }
.task-log li { display: grid; gap: 2px; padding: 6px 0; border-bottom: 1px solid var(--line-soft); }
.task-plan summary { cursor: pointer; min-height: 32px; display: flex; align-items: center; }
</style>
