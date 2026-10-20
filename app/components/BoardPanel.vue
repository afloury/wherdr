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
// Opened from the sheet's "Open the chat" (`chat`), a task herdr-projects
// takes a reply for but whose agent has no pane gets a message field instead,
// sent with `tell`, until its agent shows up again.
// A coordinator's pane is the one herdr-projects keeps for it (`coordinator
// status`, asked by the server), never one guessed from a name. One not
// started yet gets a field whose first message starts it (`coordinator tell`);
// the panel asks again until its pane shows up, then turns into its
// conversation. One whose start failed says why, as herdr-projects wrote it
// down, with Try again (`coordinator restart`) once it is fixed: it never
// says "starting" while herdr-projects has given up. Everything asked for a
// coordinator belongs to that target: a reply that comes back once another
// one is shown is dropped.
//
// Above a task's conversation: its title, its description (folded after a few
// lines), the Watcher's progress, and the agent's closing note and research
// report once there is one (`details`, read again as the task moves on).
import { type CoordinatorStatus, type CoordinatorTarget, type TaskDetails, type TaskRow, TELL_MAX, coordinatorPhase, coordinatorSubject, taskActions, taskKey } from '#shared/projectsTasks'

export type PanelTarget =
  | { machine: string, kind: 'task', id: string, chat?: boolean }
  | { machine: string, kind: 'coordinator', to: CoordinatorTarget }

// `reachable`: its machine's board answers now (a message waits while it does not).
const props = defineProps<{ target: PanelTarget, task: TaskRow | null, machineLabel: string, readOnly?: boolean, reachable?: boolean }>()
const emit = defineEmits<{ close: [], sheet: [], noAgent: [] }>()

// ------------------------------------------------------------ a task's agent
const taskPane = ref<string | null>(null)
const details = ref<TaskDetails | null>(null)
const loading = ref(false)
const failed = ref('')
// No pane, but herdr-projects passes a reply on (`tell`): the field shown instead.
const tellOnly = ref(false)
const canTell = (d: TaskDetails) => Boolean(props.task) && !props.readOnly && taskActions(props.task!, d).tell
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
    if (!d.pane) {
      // Asked for its chat, and a reply can still reach it: the field here.
      if (t.chat && canTell(d)) {
        tellOnly.value = true
        return
      }
      // No agent to talk to: its sheet, with what can be done (Start…).
      return emit('noAgent')
    }
    tellOnly.value = false
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

// A reply to a task with no pane: herdr-projects passes it on (`tell`). The
// panel is one per task, so a late answer never lands on another one.
const reply = ref('')
const telling = ref(false)
async function tell() {
  const t = props.target
  const text = reply.value.trim()
  if (t.kind !== 'task' || !text || telling.value || !props.reachable) return
  telling.value = true
  try {
    await api('/api/tasks/tell', { machine: t.machine, id: t.id, text })
    haptic()
    toast(tl('Sent to the task’s agent', 'Envoyé à l’agent de la tâche'))
    reply.value = ''
    // Its agent may be back on a pane: its conversation then shows here.
    loadTask(true)
  } catch (e) { toast((e as Error).message, true) }
  finally { telling.value = false }
}

// ------------------------------------------------------------ a coordinator
// `gen` changes with the target: what comes back for an earlier one is dropped.
let gen = 0
const coordPane = ref<string | null>(null)
const coordLoaded = ref(false)
// What herdr-projects said of it last: its state, why its start failed, its name.
const coordState = ref('')
const coordError = ref('')
const coordQueued = ref<number | null>(null)
const coordStatusName = ref('')
let poll: ReturnType<typeof setTimeout> | undefined
let tries = 0
// `look` numbers each lookup: only the latest one's answer counts. Two lookups
// of the same coordinator can come back in any order; an earlier one's answer
// (a pane, "none", a failure, its retry) is dropped.
let look = 0
async function lookCoordinator(g: number) {
  const t = props.target
  if (t.kind !== 'coordinator' || g !== gen) return
  clearTimeout(poll)
  const n = ++look
  const latest = () => g === gen && n === look
  try {
    const q = new URLSearchParams({ machine: t.machine, kind: t.to.kind, ...(t.to.kind === 'project' ? { repo: t.to.repo } : {}) })
    const r = await api<Partial<CoordinatorStatus>>(`/api/tasks/coordinator?${q}`)
    if (!latest()) return
    coordPane.value = r.pane ?? null
    coordState.value = r.state ?? ''
    coordError.value = r.error ?? ''
    coordQueued.value = r.queued ?? null
    // Its name stays what it was when a reply leaves it out.
    if (r.name) coordStatusName.value = r.name
    // Starting (or just told to): asked again until it has a pane. A pane Herdr
    // does not show (yet, or any more): asked again too, for the one it has now.
    // A failed start is not tried again by itself: nothing to wait for.
    const phase = coordinatorPhase({ pane: coordPane.value, state: coordState.value, error: coordError.value })
    const unseen = Boolean(r.pane) && herdrState.value.ok && !herdrState.value.panes.some(p => p.id === r.pane)
    if ((unseen || phase === 'starting' || (sent.value && phase === 'idle')) && ++tries <= 40) poll = setTimeout(() => lookCoordinator(g), 3000)
  } catch {
    if (latest() && sent.value && ++tries <= 40) poll = setTimeout(() => lookCoordinator(g), 3000)
  } finally {
    if (latest()) coordLoaded.value = true
  }
}
onUnmounted(() => { gen++; clearTimeout(poll) })
// The coordinator's pane once Herdr shows it.
const coordShown = computed(() => (coordPane.value && herdrState.value.panes.some(p => p.id === coordPane.value) ? coordPane.value : null))
// Asked again while none is shown and Herdr's agents change (its pane closed,
// a coordinator restarted or started from Herdr), and when its machine is back.
function relook() {
  if (props.target.kind !== 'coordinator') return
  tries = 0
  lookCoordinator(gen)
}
let settle: ReturnType<typeof setTimeout> | undefined
watch(() => (props.target.kind === 'coordinator' && coordLoaded.value && !coordShown.value
  ? herdrState.value.panes.filter(p => p.agent).map(p => p.id).join(' ')
  : null), (k, was) => {
  if (k === null || was === null || k === was) return
  clearTimeout(settle)
  settle = setTimeout(relook, 800)
})
// The pane it had closed: asked at once for the one it has now.
watch(() => props.target.kind === 'coordinator' && Boolean(coordPane.value) && herdrState.value.ok && !coordShown.value, (lost) => {
  if (lost) { clearTimeout(settle); settle = setTimeout(relook, 800) }
})
watch(() => props.reachable, (r, was) => { if (r && was === false) relook() })
onUnmounted(() => clearTimeout(settle))

const paneId = computed(() => (props.target.kind === 'task' ? taskPane.value : coordShown.value))
// A task's agent that closes while shown: back to its sheet.
const gone = computed(() => props.target.kind === 'task' && Boolean(taskPane.value) && herdrState.value.ok
  && !herdrState.value.panes.some(p => p.id === taskPane.value))
watch(gone, (g) => { if (g) emit('noAgent') })

// ------------------------------------------------------------ who it is
// Match the Board entry points: all work, machine setup, repo work.
const coordSubject = computed(() => (props.target.kind === 'coordinator' ? coordinatorSubject(props.target.to, props.machineLabel, coordStatusName.value) : ''))
const coordName = computed(() => {
  if (props.target.kind !== 'coordinator') return ''
  return props.target.to.kind === 'main' ? tl('Coordinator', 'Coordinateur') : coordinatorLabel(props.target.to, props.machineLabel)
})
// "The Coordinator", "the web coordinator", in a sentence.
const coordThe = computed(() => {
  if (props.target.kind === 'coordinator' && props.target.to.kind === 'machine') return tl(`The ${props.machineLabel} setup assistant`, `L’assistant de configuration de ${props.machineLabel}`)
  const s = coordSubject.value
  return s ? tl(`The ${s} coordinator`, `Le coordinateur ${s}`) : tl('The Coordinator', 'Le Coordinateur')
})
// Not shown (its conversation is): what the panel says instead.
const coordPhase = computed(() => coordinatorPhase({ pane: coordPane.value, state: coordState.value, error: coordError.value }))
// herdr-projects keeps delivery errors even after the agent exits.
const coordDeliveryFailed = computed(() => /\bmessage could not be typed\b/i.test(coordError.value))
const coordFailureTitle = computed(() => coordDeliveryFailed.value
  ? tl('Message could not be sent', 'Envoi du message impossible')
  : tl('Could not start', 'Démarrage impossible'))
const coordQueueNotice = computed(() => {
  const n = coordQueued.value
  if (n === null) return tl('The message queue status is unavailable.', 'L’état de la file de messages est indisponible.')
  if (n === 0) return tl('No message is waiting.', 'Aucun message en attente.')
  return n === 1
    ? tl('1 message still waiting: it goes in once it runs.', '1 message attend toujours : il part dès qu’il tourne.')
    : tl(`${n} messages still waiting: they go in once it runs.`, `${n} messages attendent toujours : ils partent dès qu’il tourne.`)
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
const retrying = ref(false)
watch(() => JSON.stringify(props.target), () => {
  gen++
  clearTimeout(poll)
  clearTimeout(settle)
  tries = 0
  first.value = ''
  sent.value = false
  starting.value = false
  retrying.value = false
  coordPane.value = null
  coordLoaded.value = false
  coordState.value = ''
  coordError.value = ''
  coordQueued.value = null
  coordStatusName.value = ''
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
    // herdr-projects queued the words and cleared any earlier failure.
    coordState.value = 'starting'
    coordError.value = ''
    tries = 0
    lookCoordinator(g)
  } catch (e) { toast((e as Error).message, true) }
  finally { if (g === gen) starting.value = false }
}
// Try again, once what stopped it is fixed: started again with the words
// still waiting (`coordinator restart`), nothing typed again.
async function retry() {
  const t = props.target
  if (t.kind !== 'coordinator' || retrying.value || !props.reachable) return
  const g = gen
  retrying.value = true
  try {
    await api('/api/tasks/coordinator', { machine: t.machine, to: t.to, restart: true })
    haptic()
    if (g !== gen) return
    sent.value = true
    coordState.value = 'starting'
    coordError.value = ''
    tries = 0
    lookCoordinator(g)
  } catch (e) { if (g === gen) toast((e as Error).message, true) }
  finally { if (g === gen) retrying.value = false }
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
        <p v-if="target.kind === 'coordinator'" class="board-panel-purpose">{{ coordinatorDescription(target.to) }}</p>
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
      <div v-else-if="target.kind === 'task' && tellOnly" class="board-panel-start">
        <form class="board-panel-first board-panel-tell" @submit.prevent="tell">
          <label for="board-panel-tell">{{ task?.stage === 'plan'
            ? tl('Its agent is not running now: your words send the plan back, through herdr-projects.', 'Son agent ne tourne pas en ce moment : tes mots renvoient le plan, par herdr-projects.')
            : tl('Its agent is not running now: herdr-projects passes your reply on.', 'Son agent ne tourne pas en ce moment : herdr-projects lui transmet ta réponse.') }}</label>
          <p v-if="!reachable" class="board-panel-away" role="status">
            {{ tl(`${machineLabel} cannot be reached now.`, `${machineLabel} est injoignable pour l’instant.`) }}
          </p>
          <UTextarea id="board-panel-tell" v-model="reply" :rows="3" autoresize :maxlength="TELL_MAX" :placeholder="tl('Message', 'Message')" :disabled="offlineView" />
          <UButton type="submit" color="primary" icon="i-lucide-send" :loading="telling" :disabled="!reply.trim() || offlineView || !reachable">{{ t('Send') }}</UButton>
        </form>
      </div>
      <p v-else-if="target.kind === 'coordinator' && !coordLoaded && !readOnly" class="board-empty board-panel-wait">{{ t('Loading…') }}</p>
      <div v-else-if="target.kind === 'coordinator'" class="board-panel-start">
        <p v-if="readOnly" class="board-note">{{ tl('This coordinator has not started. wherdr runs in a container here: start it from Herdr on the host, or move wherdr to the native service to start it from here.', 'Ce coordinateur n’a pas démarré. wherdr tourne ici dans un conteneur : lance-le depuis Herdr sur l’hôte, ou passe wherdr en service natif pour le lancer d’ici.') }}</p>
        <section v-else-if="coordPhase === 'failed'" class="board-panel-failed" role="alert" :aria-label="coordFailureTitle">
          <h4><UIcon name="i-lucide-octagon-alert" />{{ coordFailureTitle }}</h4>
          <p class="board-panel-failed-what">{{ coordDeliveryFailed
            ? tl(`The message could not be typed into ${coordName} on ${machineLabel}.`, `Le message n’a pas pu être saisi dans ${coordName} sur ${machineLabel}.`)
            : tl(`${coordThe} could not start on ${machineLabel}.`, `${coordThe} n’a pas pu démarrer sur ${machineLabel}.`) }}</p>
          <p class="board-panel-failed-why">{{ coordError }}</p>
          <p class="board-panel-failed-next">{{ tl('Fix this on the machine, then try again.', 'Corrige cela sur la machine, puis réessaie.') }} {{ coordQueueNotice }}</p>
          <p v-if="!reachable" class="board-panel-away" role="status">
            {{ tl(`${machineLabel} cannot be reached now.`, `${machineLabel} est injoignable pour l’instant.`) }}
          </p>
          <UButton color="neutral" variant="outline" icon="i-lucide-rotate-cw" :loading="retrying" :disabled="offlineView || !reachable" @click="retry">{{ t('Try again') }}</UButton>
        </section>
        <p v-else-if="coordPhase === 'live'" class="board-empty">{{ t('Loading…') }}</p>
        <p v-else-if="coordPhase === 'starting'" class="board-empty board-panel-starting" role="status">
          {{ sent ? tl(`Sent. ${coordThe} is starting: its conversation opens here.`, `Envoyé. ${coordThe} démarre : sa conversation s’ouvre ici.`) : tl(`${coordThe} is starting: its conversation opens here.`, `${coordThe} démarre : sa conversation s’ouvre ici.`) }}
        </p>
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
