<script setup lang="ts">
// The Board's side panel: one agent to talk to, a task's or a coordinator's,
// in wherdr's own agent view (AgentView, as a side-by-side cell: conversation,
// terminal, message field). Its heading always says who: the machine, the
// repo, the task or the coordinator, so several machines on one Board are
// never mixed up. A computer keeps the Board beside it; a phone shows it full
// screen, with a way back to the Board.
//
// A task's agent is the pane its details name. A task with no agent (to do,
// or its agent gone) is not shown here: `noAgent` asks the Board for its
// sheet instead; `sheet` (its "Task" button) opens the sheet over the panel.
// A coordinator's pane is the one herdr-projects keeps for it (`coordinator
// status`, asked by the server), never one guessed from a name. One not
// started yet gets a field whose first message starts it (`coordinator tell`);
// the panel asks again until its pane shows up, then turns into its
// conversation. Everything asked for a coordinator belongs to that target: a
// reply that comes back once another one is shown is dropped.
//
// Above a task's conversation: its title, its description (folded after a few
// lines), the Watcher's progress, and the agent's closing note and research
// report once there is one (`details`, read again as the task moves on).
import { type CoordinatorTarget, type TaskDetails, type TaskRow, TELL_MAX, taskKey } from '#shared/projectsTasks'

export type PanelTarget =
  | { machine: string, kind: 'task', id: string }
  | { machine: string, kind: 'coordinator', to: CoordinatorTarget }

// `reachable`: its machine's board answers now (a message waits while it does not).
const props = defineProps<{ target: PanelTarget, task: TaskRow | null, machineLabel: string, readOnly?: boolean, reachable?: boolean }>()
const emit = defineEmits<{ close: [], sheet: [], noAgent: [] }>()

// ------------------------------------------------------------ a task's agent
const taskPane = ref<string | null>(null)
const details = ref<TaskDetails | null>(null)
const loading = ref(false)
const failed = ref('')
let seq = 0
// `again`: the same task moved on (a closing note, a report): the agent stays shown.
async function loadTask(again = false) {
  const t = props.target
  if (t.kind !== 'task') return
  const n = ++seq
  if (!again) {
    taskPane.value = null
    details.value = null
    failed.value = ''
    loading.value = true
  }
  try {
    const d = await api<TaskDetails & { pane: string | null }>(`/api/tasks/details?machine=${encodeURIComponent(t.machine)}&id=${encodeURIComponent(t.id)}`)
    if (n !== seq) return
    details.value = d
    // No agent to talk to: its sheet, with what can be done (Start…).
    if (!d.pane) return emit('noAgent')
    taskPane.value = d.pane
  } catch (e) {
    if (n === seq && !again) failed.value = (e as Error).message
  } finally {
    if (n === seq) loading.value = false
  }
}
watch(() => props.target.kind === 'task' ? `${props.target.machine}|${props.target.id}` : '', (k) => { if (k) loadTask() }, { immediate: true })
watch(() => (props.task ? `${props.task.stage}|${props.task.group}|${props.task.state}` : ''), (k, was) => { if (k && was && k !== was) loadTask(true) })

// The Watcher's estimate, as the row has it (1.x `watch`: a percentage, minutes left).
const progress = computed(() => {
  const r = props.task
  if (!r || r.progress === null || r.group !== 'working') return null
  const eta = r.eta === null ? '' : r.eta < 60 ? tl(`about ${r.eta} min left`, `environ ${r.eta} min restantes`) : tl(`about ${Math.round(r.eta / 60)} h left`, `environ ${Math.round(r.eta / 60)} h restantes`)
  return { pct: Math.max(0, Math.min(100, r.progress)), eta }
})

// ------------------------------------------------------------ a coordinator
// `gen` changes with the target: what comes back for an earlier one is dropped.
let gen = 0
const coordPane = ref<string | null>(null)
const coordLoaded = ref(false)
let poll: ReturnType<typeof setTimeout> | undefined
let tries = 0
async function lookCoordinator(g: number) {
  const t = props.target
  if (t.kind !== 'coordinator' || g !== gen) return
  clearTimeout(poll)
  try {
    const q = new URLSearchParams({ machine: t.machine, kind: t.to.kind, ...(t.to.kind === 'project' ? { repo: t.to.repo } : {}) })
    const r = await api<{ pane: string | null, state: string }>(`/api/tasks/coordinator?${q}`)
    if (g !== gen) return
    coordPane.value = r.pane
    // Starting (or just told to): asked again until it has a pane.
    if (!r.pane && (r.state === 'starting' || sent.value) && ++tries <= 40) poll = setTimeout(() => lookCoordinator(g), 3000)
  } catch {
    if (g === gen && sent.value && ++tries <= 40) poll = setTimeout(() => lookCoordinator(g), 3000)
  } finally {
    if (g === gen) coordLoaded.value = true
  }
}
onUnmounted(() => { gen++; clearTimeout(poll) })
// The coordinator's pane once Herdr shows it.
const coordShown = computed(() => (coordPane.value && herdrState.value.panes.some(p => p.id === coordPane.value) ? coordPane.value : null))

const paneId = computed(() => (props.target.kind === 'task' ? taskPane.value : coordShown.value))
// A task's agent that closes while shown: back to its sheet.
const gone = computed(() => props.target.kind === 'task' && Boolean(taskPane.value) && herdrState.value.ok
  && !herdrState.value.panes.some(p => p.id === taskPane.value))
watch(gone, (g) => { if (g) emit('noAgent') })

// ------------------------------------------------------------ who it is
const coordName = computed(() => {
  const t = props.target
  if (t.kind !== 'coordinator') return ''
  if (t.to.kind === 'project') return tl(`${t.to.repo} coordinator`, `Coordinateur ${t.to.repo}`)
  if (t.to.kind === 'machine') return tl('Machine coordinator', 'Coordinateur de la machine')
  return tl('Coordinator', 'Coordinateur')
})
const repo = computed(() => {
  const t = props.target
  if (t.kind === 'task') return props.task?.repo || t.id.split('/')[0] || ''
  return t.to.kind === 'project' ? t.to.repo : ''
})
const taskLabel = computed(() => {
  const t = props.target
  return t.kind === 'task' ? taskKey(t.id, props.task?.repoKey) : ''
})

// ------------------------------------------------------------ a coordinator not started
const first = ref('')
const starting = ref(false)
const sent = ref(false)
watch(() => JSON.stringify(props.target), () => {
  gen++
  clearTimeout(poll)
  tries = 0
  first.value = ''
  sent.value = false
  starting.value = false
  coordPane.value = null
  coordLoaded.value = false
  lookCoordinator(gen)
}, { immediate: true })
async function start() {
  const t = props.target
  const text = first.value.trim()
  if (t.kind !== 'coordinator' || !text || starting.value || !props.reachable) return
  const g = gen
  starting.value = true
  try {
    await api('/api/tasks/coordinator', { machine: t.machine, text, to: t.to })
    haptic()
    // Another coordinator is shown now: its field and its words stay as they are.
    if (g !== gen) return
    first.value = ''
    sent.value = true
    tries = 0
    lookCoordinator(g)
  } catch (e) { toast((e as Error).message, true) }
  finally { if (g === gen) starting.value = false }
}

// Escape closes it on a computer, unless a sheet or a field has it.
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !desk.value || e.defaultPrevented) return
  if (document.querySelector('.hw-sheet')) return
  emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// Keyboard open (iPhone): the panel fits the visible part, as the agent view does.
const style = computed(() => (!desk.value && kbOpen.value ? { height: `${vvHeight.value}px`, top: `${vvTop.value}px` } : {}))
</script>

<template>
  <aside class="board-panel" :class="{ desk }" :style="style" :data-kind="target.kind" :aria-label="tl('Conversation', 'Conversation')">
    <header class="board-panel-head">
      <UButton
        v-if="!desk" icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn board-panel-back"
        :aria-label="tl('Back to the Board', 'Retour au Board')" @click="emit('close')"
      />
      <div class="board-panel-who">
        <p class="board-panel-path">
          <span class="board-panel-machine"><UIcon name="i-lucide-server" />{{ machineLabel }}</span>
          <span v-if="repo" class="board-panel-repo">{{ repo }}</span>
        </p>
        <p class="board-panel-name">
          <template v-if="target.kind === 'task'">
            <span class="task-key">{{ taskLabel }}</span>
            <span class="board-panel-title">{{ task?.app ? tl(`its agent · ${task.app}`, `son agent · ${task.app}`) : tl('its agent', 'son agent') }}</span>
          </template>
          <template v-else>
            <UIcon name="i-lucide-message-square-text" class="board-panel-coord-icon" />
            <span class="board-panel-title">{{ coordName }}</span>
          </template>
        </p>
      </div>
      <UButton
        v-if="target.kind === 'task'" icon="i-lucide-file-text" color="neutral" variant="outline" size="sm" class="board-panel-sheet"
        :aria-label="tl('Task details and actions', 'Fiche et actions de la tâche')" @click="emit('sheet')"
      >
        <span class="board-panel-sheet-label">{{ tl('Task', 'Fiche') }}</span>
        <span v-if="task" class="task-state" :class="task.group">{{ taskGroupLabel(task.group) }}</span>
      </UButton>
      <UButton
        v-if="desk" icon="i-lucide-x" color="neutral" variant="ghost" size="md" class="icon-btn board-panel-close"
        :aria-label="t('Close')" @click="emit('close')"
      />
    </header>

    <section v-if="target.kind === 'task' && (details || task)" class="board-panel-task" :aria-label="tl('The task', 'La tâche')">
      <h3 class="board-panel-task-title">{{ details?.title || task?.title }}</h3>
      <div v-if="details?.description" class="board-panel-desc"><FoldText :lines="4"><span class="board-panel-text">{{ details.description }}</span></FoldText></div>
      <div v-if="progress || task?.msg" class="board-panel-watch">
        <div v-if="progress" class="board-panel-progress" role="progressbar" :aria-valuenow="progress.pct" aria-valuemin="0" aria-valuemax="100" :aria-label="tl('Progress', 'Avancement')">
          <span :style="{ width: `${progress.pct}%` }" />
        </div>
        <p class="board-panel-watch-line">
          <b v-if="progress">{{ progress.pct }}%</b><span v-if="progress?.eta">{{ progress.eta }}</span><span v-if="task?.msg" class="board-panel-msg">{{ task.msg }}</span>
        </p>
      </div>
      <div v-if="details?.summary || details?.report" class="board-panel-note">
        <h4>{{ tl('Closing note', 'Rapport de fin') }}</h4>
        <FoldText v-if="details.summary" :lines="4"><span class="board-panel-text">{{ details.summary }}</span></FoldText>
        <p v-if="details.report" class="board-panel-report">
          <UIcon name="i-lucide-file-text" />
          <a v-if="details.report.link" :href="details.report.link" target="_blank" rel="noopener noreferrer">{{ details.report.file }}</a>
          <span v-else>{{ tl(`Research report: ${details.report.file}`, `Rapport de recherche : ${details.report.file}`) }}</span>
        </p>
      </div>
    </section>

    <div class="board-panel-body">
      <AgentView v-if="paneId" :key="paneId" :pane-id="paneId" cell active />
      <p v-else-if="target.kind === 'task' && loading" class="board-empty board-panel-wait">{{ t('Loading…') }}</p>
      <p v-else-if="failed" class="board-note error board-panel-wait">{{ failed }}</p>
      <p v-else-if="target.kind === 'coordinator' && !coordLoaded && !readOnly" class="board-empty board-panel-wait">{{ t('Loading…') }}</p>
      <div v-else-if="target.kind === 'coordinator'" class="board-panel-start">
        <p v-if="readOnly" class="board-note">{{ tl('This coordinator has not started. wherdr runs in a container here: start it from Herdr on the host.', 'Ce coordinateur n’a pas démarré. wherdr tourne ici dans un conteneur : lance-le depuis Herdr sur l’hôte.') }}</p>
        <template v-else-if="sent">
          <p class="board-empty">{{ tl(`Sent. The ${coordName.replace(/ coordinator$/, '')} coordinator is starting: its conversation opens here.`, `Envoyé. Le ${coordName.toLowerCase()} démarre : sa conversation s’ouvre ici.`) }}</p>
        </template>
        <form v-else class="board-panel-first" @submit.prevent="start">
          <label for="board-panel-first">{{ tl('Not started yet: your first message starts it.', 'Pas encore démarré : ton premier message le lance.') }}</label>
          <p v-if="!reachable" class="board-panel-away" role="status">
            {{ tl(`${machineLabel} cannot be reached now: your message waits for it here.`, `${machineLabel} est injoignable pour l’instant : ton message l’attend ici.`) }}
          </p>
          <UTextarea id="board-panel-first" v-model="first" :rows="3" autoresize :maxlength="TELL_MAX" :placeholder="tl('Message', 'Message')" :disabled="offlineView" />
          <UButton type="submit" color="primary" icon="i-lucide-send" :loading="starting" :disabled="!first.trim() || offlineView || !reachable">{{ t('Send') }}</UButton>
        </form>
      </div>
    </div>
  </aside>
</template>
