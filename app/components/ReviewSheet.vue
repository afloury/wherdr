<script setup lang="ts">
// Tasks to review, one at a time (a sheet on the phone, a window on a computer):
// what waits for the user on the board (Your turn), under the filter at the top
// (useReview.ts). A task to approve shows its key, title and project, its TL;DR
// (TaskTldr), its newest screenshots (TaskShots, the task sheet's viewer), its PR
// and the review's verdict in one line, then Approve (the To do tab's Accept: it
// leaves the list, the engine merges it in its own order) and Skip (the next one;
// it stays in the list). Anything else that waits (a question, a failure, a
// decision) shows what it waits for and opens where the user answers. "3 of 12"
// with previous and next; on a computer → next, ← previous, A approve, S skip.
// After the last one: All done.
import { linkLabel, mayAccept, prLink, taskRow, type Board, type Card, type ToHandle } from '#shared/pm/board'
import { reviewLine, reviewNote, workerNote } from '#shared/pm/report'
import { shotMode } from '#shared/pm/shots'
import type { Task } from '#shared/pm/run'

const emit = defineEmits<{ closed: [] }>()
const open = ref(true)
const data = ref<Board | null>(null)
const load = () => api<Board>('/api/pm/board').then((b) => { data.value = b }, () => {})
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { load(); timer = setInterval(() => { if (!document.hidden) load() }, 10_000); addEventListener('keydown', onKey) })
onBeforeUnmount(() => { clearInterval(timer); removeEventListener('keydown', onKey) })
watch(taskSheetTick, load)

const projects = computed(() => data.value?.projects ?? [])
const filterItems = computed(() => [
  { label: tl('Follow group tab'), value: REVIEW_FOLLOW },
  { label: tl('All'), value: REVIEW_ALL },
  ...machineGroups.value.map(g => ({ label: g.name, value: g.id })),
  ...projects.value.map(p => ({ label: p.name, value: `p:${p.key}` })),
])
const known = (v: string) => filterItems.value.some(i => i.value === v) || (!data.value && v.startsWith('p:'))
const filter = computed({ get: () => reviewPick(known), set: (v: string) => { reviewFilter.value = v } })

// Approved here: off the list at once, before the board says so.
const approved = ref<string[]>([])
const items = computed(() => (data.value?.cards ?? []).filter(c => c.yourTurn && !c.state?.done && !approved.value.includes(c.id) && reviewShows(filter.value, c.project)))
// items.length: past the last one, All done.
const at = ref(0)
const index = computed(() => Math.min(at.value, items.value.length))
const card = computed<Card | undefined>(() => items.value[index.value])
// Another filter, or another home tab followed: back to the first one.
watch([filter, machineBarPick], () => { at.value = 0 })
const go = (step: number) => { at.value = Math.max(0, Math.min(index.value + step, items.value.length)) }

const kind = computed(() => (card.value ? taskTodo(card.value) : undefined))
// Only a merge to accept: another step of the user's (Create these tasks…) keeps its own button, in the task's sheet.
const approves = computed(() => !!card.value && (kind.value === 'merge' || kind.value === 'step') && mayAccept(card.value))
const row = computed<ToHandle | undefined>(() => (card.value ? taskRow(card.value) : undefined))
const shotStep = computed(() => (card.value ? shotSteps(card.value)[0] : undefined))
const shots = computed(() => (shotStep.value ? card.value!.state!.shots![shotStep.value.id]! : []))
const pr = computed(() => (card.value ? prLink(card.value) : undefined))
const state = computed(() => card.value?.state)
const verdict = computed(() => (card.value && state.value ? reviewLine(card.value.plan, state.value.at, state.value.rounds) : undefined))
const notes = computed(() => (card.value && state.value ? { worker: workerNote(card.value.plan, state.value), review: reviewNote(card.value.plan, state.value) } : {}))

const busy = ref(false)
const error = ref('')
watch(() => card.value?.id, () => { error.value = '' })
async function approve() {
  const c = card.value
  if (!c || !approves.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const { task } = await api<{ task: Task }>('/api/pm/step-user', { id: c.id })
    if (task.step?.yourTurn?.reason === 'action') error.value = stepRefusalText(task.step.yourTurn.badge)
    else approved.value = [...approved.value, c.id]
    taskChanged()
  }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
const skip = () => go(1)

// Where the user answers anything else: the asking agent's conversation when it is on screen here, else the task's sheet.
function answer(where: 'agent' | 'sheet' = 'agent') {
  const c = card.value
  if (!c) return
  const pane = where === 'agent' && row.value?.terminal ? herdrState.value?.panes.find(p => p.coreAddress === row.value!.terminal) : undefined
  open.value = false
  if (pane) navigateTo(panePath(pane.id))
  else openTaskSheet(c.id)
}

function onKey(e: KeyboardEvent) {
  // The screenshot viewer open over it has its own keys (← →).
  if (e.defaultPrevented || lightboxSrc.value || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"], [role="listbox"]')) return
  const k = e.key.toLowerCase()
  if (k === 'arrowright') go(1)
  else if (k === 'arrowleft') go(-1)
  else if (k === 'a') approve()
  else if (k === 's') skip()
  else return
  e.preventDefault()
}
</script>

<template>
  <AppSheet v-model:open="open" :title="tl('Tasks to review')" tall @closed="emit('closed')">
    <div class="review" data-testid="review-sheet">
      <USelect v-model="filter" :items="filterItems" size="lg" class="review-filter" :aria-label="tl('Tasks shown')" data-testid="review-filter" />

      <article v-if="card && row" class="review-item" :data-task="card.id" :data-kind="approves ? 'approve' : 'answer'" data-testid="review-item">
        <header class="review-head">
          <ProjectBadge :text="card.shown" :color="card.color" />
          <h3>{{ card.title }}</h3>
        </header>
        <template v-if="approves">
          <TaskTldr :card="card" :worker="notes.worker" :review="notes.review" @comments="answer('sheet')">
            <TaskShots v-if="shots.length && shotStep" :task="card.id" :shots="shots" :mode="shotMode(shotStep)" />
          </TaskTldr>
          <p class="review-meta">
            <a v-if="pr" :href="pr.url" target="_blank" rel="noopener" data-testid="review-pr">{{ linkLabel(pr) }}</a>
            <span v-if="verdict" data-testid="review-verdict">{{ tl(verdict) }}</span>
          </p>
        </template>
        <template v-else>
          <p class="review-say" data-testid="review-say">{{ t(row.action) }}</p>
          <p v-if="card.asks" class="review-ask">{{ card.asks.text }}</p>
        </template>
        <p v-if="error" class="error" role="alert" data-testid="review-error">{{ error }}</p>
      </article>

      <div v-else-if="data" class="review-done" data-testid="review-done">
        <UIcon name="i-lucide-check-check" class="review-done-icon" />
        <p><b>{{ tl('All done') }}</b></p>
        <p class="muted">{{ items.length ? tl(`${items.length} skipped, still in the list.`) : tl('The engine takes over: approved tasks merge in their own order.') }}</p>
        <UButton v-if="items.length" color="neutral" variant="outline" size="xl" icon="i-lucide-rotate-ccw" data-testid="review-restart" @click="at = 0">{{ tl('Back to the first') }}</UButton>
      </div>
    </div>

    <template #footer>
      <div v-if="card" class="review-foot">
        <div class="review-choices">
          <UButton v-if="approves" color="primary" size="xl" icon="i-lucide-check" :loading="busy" data-testid="review-approve" @click="approve">{{ tl('Approve') }}</UButton>
          <UButton v-else color="primary" size="xl" icon="i-lucide-square-arrow-out-up-right" data-testid="review-answer" @click="answer()">{{ row?.terminal ? tl('Answer the agent') : tl('Open the task') }}</UButton>
          <UButton color="neutral" variant="outline" size="xl" icon="i-lucide-skip-forward" :disabled="busy" data-testid="review-skip" @click="skip">{{ tl('Skip') }}</UButton>
        </div>
        <nav class="review-nav" :aria-label="tl('Progress')">
          <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn" :disabled="index === 0" :aria-label="tl('Previous')" data-testid="review-prev" @click="go(-1)" />
          <span class="mono-label" data-testid="review-progress">{{ tl(`${index + 1} of ${items.length}`) }}</span>
          <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="tl('Next')" data-testid="review-next" @click="go(1)" />
        </nav>
      </div>
    </template>
  </AppSheet>
</template>

<style scoped>
.review { display: flex; flex-direction: column; gap: 12px; flex: 1 0 auto; min-width: 0; padding: 0 16px; }
.review p { margin: 0; }
.review-filter { width: 100%; }
.review-item { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.review-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.review-head h3 { flex: 1; min-width: 0; margin: 0; font: 600 16px/1.3 var(--display); overflow-wrap: anywhere; }
.review-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--muted); font: 12px/1.4 var(--mono); }
.review-meta a { color: var(--accent); }
.review-say { color: var(--text); font-weight: 600; overflow-wrap: anywhere; }
.review-ask { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-2); }
.review-done { display: grid; gap: 8px; justify-items: center; padding: 32px 0; text-align: center; }
.review-done-icon { width: 32px; height: 32px; color: var(--done); }
.review-foot { display: grid; gap: 8px; padding: 12px 16px 0; border-top: 1px solid var(--line-soft); }
.review-choices { display: flex; flex-wrap: wrap; gap: 8px; }
.review-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
@media (max-width: 699px) {
  .review-choices > * { flex: 1 1 auto; justify-content: center; }
}
</style>
