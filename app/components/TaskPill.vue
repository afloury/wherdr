<script setup lang="ts">
// The task id pill in a task agent's header (AgentView): a tap opens, in place, where the
// task stands (its state and step), the button of the step that waits for the user (the
// task sheet's own, through useTaskActions: the same request, its refusal said under it, a check
// for a moment once through) and Open the task (its sheet). Nothing to press unless the task
// waits that way (taskTodo: a merge or a step ending with the user). Before the board is
// read, or for a task not on it, the pill stays a plain badge.
import { canStop, mergeGoesNow, mergeStuck, mergeWaits, mayAccept, taskRow } from '#shared/pm/board'
import { DONE_MS, taskTodo } from '~/utils/taskTodo'

const props = defineProps<{ task: string, text: string, color?: string }>()
const card = useBoardCard(() => props.task)
const open = ref(false)
const { busy, pressing, refused, error, press, markDone } = useTaskActions(() => card.value ?? undefined, taskChanged)

const row = computed(() => (card.value ? taskRow(card.value) : null))
const step = computed(() => (card.value?.state?.started && !card.value.state.done ? card.value.step : undefined))
const waiting = computed(() => (card.value ? ['merge', 'step'].includes(taskTodo(card.value) ?? '') && !!card.value.userLabel : false))
const waits = computed(() => (card.value ? mergeWaits(card.value) : undefined))
const stuck = computed(() => (card.value ? mergeStuck(card.value) : undefined))
const goes = computed(() => !stuck.value && !!card.value && mergeGoesNow(card.value))
const accepts = computed(() => !!card.value && mayAccept(card.value))
const merging = computed(() => waits.value !== undefined && !stuck.value)

const confirmed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
async function pressStep() {
  if (busy.value || confirmed.value) return
  await press()
  if (error.value || refused.value) return
  confirmed.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { confirmed.value = false }, DONE_MS)
}
onBeforeUnmount(() => clearTimeout(timer))
// Mark done asks once more: it moves the task to Done as it stands, whatever its step.
const closing = ref(false)
const finishes = computed(() => !!card.value && canStop(card.value))
async function close() {
  if (busy.value) return
  await markDone()
  if (!error.value) { closing.value = false; open.value = false }
}
watch(open, (o) => { if (!o) closing.value = false })
const openSheet = () => { open.value = false; openTaskSheet(card.value!.id) }
</script>

<template>
  <UPopover v-if="card" v-model:open="open" :content="{ side: 'bottom', align: 'start' }">
    <button type="button" class="task-pill" :aria-label="`${tl('Task')} ${text}`" data-testid="task-pill" @click.stop @pointerdown.stop>
      <ProjectBadge :text="text" :color="color" />
    </button>
    <template #content>
      <div class="task-pill-menu" role="group" :aria-label="`${tl('Task')} ${text}`" tabindex="0" data-testid="task-pill-menu" @keydown.esc.stop.prevent="open = false">
        <p class="task-pill-state" data-testid="task-pill-state">{{ row!.action }}</p>
        <p class="mono-label muted">{{ row!.label }}<template v-if="step"> · {{ step }}</template></p>
        <UButton
          v-if="waiting" color="primary" size="lg" :icon="confirmed ? 'i-lucide-check' : undefined" :class="{ confirmed }"
          :loading="pressing || goes" :disabled="busy || (!accepts && (!!stuck || (waits !== undefined && !goes)))" data-testid="task-pill-step" @click="pressStep"
        >{{ merging ? tl('Merging') : card.userLabel }}</UButton>
        <p v-if="pressing" class="muted" role="status">{{ tl('Running this step… A merge waits for the PR\'s checks, which can take a few minutes.') }}</p>
        <p v-else-if="refused" class="error" role="alert" data-testid="task-pill-refused">{{ stepRefusalText(refused) }}</p>
        <p v-else-if="error" class="error" role="alert">{{ error }}</p>
        <template v-if="finishes">
          <p v-if="closing" class="muted">{{ tl('Mark this task done? Nothing is merged or landed and no step runs.') }}</p>
          <div v-if="closing" class="task-pill-row">
            <UButton color="primary" size="lg" :loading="busy" data-testid="task-pill-done-yes" @click="close">{{ tl('Mark done') }}</UButton>
            <UButton color="neutral" variant="outline" size="lg" :disabled="busy" @click="closing = false">{{ t('Cancel') }}</UButton>
          </div>
          <UButton v-else color="neutral" variant="outline" size="lg" icon="i-lucide-check" data-testid="task-pill-done" @click="closing = true">{{ tl('Mark done') }}</UButton>
        </template>
        <UButton color="neutral" variant="outline" size="lg" icon="i-lucide-panel-right-open" data-testid="task-pill-open" @click="openSheet">{{ tl('Open the task') }}</UButton>
      </div>
    </template>
  </UPopover>
  <ProjectBadge v-else class="plain" :text="text" :color="color" />
</template>

<style scoped>
.plain, .task-pill { margin-right: var(--badge-gap); }
.task-pill { display: inline-flex; padding: 0; border: 0; background: none; cursor: pointer; vertical-align: middle; }
.task-pill:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.task-pill-menu { display: grid; gap: 8px; padding: 12px; max-width: min(320px, 90vw); justify-items: start; }
.task-pill-menu p { margin: 0; overflow-wrap: anywhere; }
.task-pill-row { display: flex; gap: 8px; }
.task-pill-state { color: var(--text); font-weight: 600; }
.task-pill-menu .confirmed { pointer-events: none; border-color: var(--done); background: var(--done); color: var(--bg); }
</style>
