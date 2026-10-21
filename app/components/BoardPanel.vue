<script setup lang="ts">
// Task panels own their compact header, three tabs and board failure banner.
// Coordinators keep their own startup/delivery lifecycle.
import { type CoordinatorStatus, type CoordinatorTarget, type TaskDetails, type TaskRow, TELL_MAX, coordinatorPhase, coordinatorSubject, taskActions, taskCanFix, taskCanApproveAnyway, taskKey, type TaskCommand } from '#shared/projectsTasks'

export type PanelTarget =
  | { machine: string, kind: 'task', id: string, chat?: boolean }
  | { machine: string, kind: 'coordinator', to: CoordinatorTarget }

// `reachable`: its machine's board answers now (a message waits while it does not).
const props = defineProps<{ target: PanelTarget, task: TaskRow | null, machineLabel: string, readOnly?: boolean, reachable?: boolean, refresh?: () => Promise<unknown> }>()
const emit = defineEmits<{ close: [], sheet: [], noAgent: [], changed: [], archived: [machine: string, task: TaskRow], restored: [machine: string, task: TaskRow] }>()

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
      tellOnly.value = canTell(d)
      taskPane.value = null
      return
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
watch(() => (props.task ? `${props.task.stage}|${props.task.group}|${props.task.state}|${props.task.msg}` : ''), (k, was) => { if (k && was && k !== was) loadTask(true) })

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

// The parent owns view selection so a setup shell never opens by default.
const selected = ref<'chat' | 'term' | 'task'>('chat')
const full = ref(false)
const taskOpen = ref(true)
const actionBusy = ref(false)
const actionError = ref('')
const agentPane = computed(() => herdrState.value.panes.find(p => p.id === taskPane.value))
const conversation = computed(() => Boolean(agentPane.value && hasChat(agentPane.value))
  && !(props.task?.stage === 'failed' && ['start', 'setup', 'attempts'].includes(details.value?.failureStage || '')))
const agentHint = computed(() => agentPane.value ? tl(`Herdr agent: ${statusLabel(agentPane.value)}`, `Agent Herdr : ${statusLabel(agentPane.value)}`) : tl('Agent not running', 'Agent arrêté'))
const taskPermissions = computed(() => props.task ? taskActions(props.task, details.value) : null)
const canFix = computed(() => props.task && taskCanFix(props.task, details.value))
const canAnyway = computed(() => props.task && taskCanApproveAnyway(props.task, details.value))
const disabled = computed(() => Boolean(actionBusy.value || props.readOnly || offlineView.value || !props.reachable || props.task?.stale))
const needs = computed(() => props.task?.group === 'needs')
const failureTitle = computed(() => details.value?.failureTitle || details.value?.msg || props.task?.msg || agentPane.value?.prompt?.question || tl('Your answer is needed', 'Ta réponse est attendue'))
const failureDetail = computed(() => details.value?.failureDetail || details.value?.failure || '')
const noticeKey = computed(() => JSON.stringify([details.value?.summary, details.value?.review, details.value?.findings]))
const seenNote = ref('')
const newNote = computed(() => Boolean(details.value?.summary || details.value?.review) && noticeKey.value !== seenNote.value)
watch([selected, noticeKey], () => { if (selected.value === 'task') seenNote.value = noticeKey.value })
function archivedTask(machine: string, task: TaskRow) { emit('archived', machine, task); emit('close') }
function restoredTask(machine: string, task: TaskRow) { emit('restored', machine, task) }
async function refreshTask() {
  if (props.refresh) await props.refresh()
  else emit('changed')
  await loadTask(true)
}
async function taskAction(action: TaskCommand | 'approve' | 'anyway') {
  const target = props.target
  if (target.kind !== 'task' || disabled.value) return
  if (action === 'anyway' && !canAnyway.value) return
  if (action === 'fix' && !canFix.value) return
  if ((action === 'approve' || action === 'anyway') && !await askConfirm(
    action === 'anyway' ? tl('Approve despite the failed review or checks? This merges the work.', 'Approuver malgré la relecture ou les contrôles en échec ? Cela fusionne le travail.') : tl('Approve this task?', 'Approuver cette tâche ?'),
    action === 'anyway' ? tl('Approve anyway', 'Approuver quand même') : tl('Approve', 'Approuver'), 'primary')) return
  if (props.target !== target || disabled.value) return
  actionBusy.value = true
  actionError.value = ''
  try {
    await api(action === 'approve' || action === 'anyway' ? '/api/tasks/approve' : '/api/tasks/action', {
      machine: target.machine, id: target.id,
      ...(action === 'approve' || action === 'anyway' ? { anyway: action === 'anyway' } : { action }),
    })
    haptic()
    await refreshTask()
  } catch (e) { actionError.value = (e as Error).message }
  finally { actionBusy.value = false }
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
watch(gone, (g) => { if (g) loadTask(true) })

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
// herdr-projects 1.2.1: status_words.rs COORDINATOR_UNSENT (pump.rs keeps it after exit).
const COORDINATOR_UNSENT = 'your message sits unsent in its box. Go into it and press enter.'
const coordDeliveryFailed = computed(() => coordError.value === COORDINATOR_UNSENT)
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
  <aside class="board-panel" :class="{ desk, expanded: full }" :style="style" :data-kind="target.kind" :aria-label="tl('Conversation', 'Conversation')">
    <header class="board-panel-head">
      <UButton
        v-if="!desk" icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn board-panel-back"
        :aria-label="tl('Back to the Board', 'Retour au Board')" @click="emit('close')"
      />
      <div class="board-panel-who">
        <p class="board-panel-path">
          <span class="board-panel-machine"><UIcon name="i-lucide-server" />{{ machineLabel }}</span>
          <span v-if="repo" class="board-panel-repo">{{ repo }}</span><span v-if="target.kind === 'task' && (task?.app || details?.agent)" :title="agentHint">· {{ task?.app || details?.agent }}</span>
        </p>
        <p class="board-panel-name">
          <template v-if="target.kind === 'task'">
            <AgentAvatar :agent="task?.app || details?.agent || null" :title="agentHint" />
            <span class="task-key">{{ taskLabel }}</span><span class="board-panel-title" :title="details?.title || task?.title">{{ details?.title || task?.title }}</span><span v-if="task" class="task-state" :class="task.group">{{ taskGroupLabel(task.group) }}</span>
          </template>
          <template v-else>
            <UIcon name="i-lucide-message-square-text" class="board-panel-coord-icon" />
            <span class="board-panel-title">{{ coordName }}</span>
          </template>
        </p>
        <p v-if="target.kind === 'coordinator'" class="board-panel-purpose">{{ coordinatorDescription(target.to) }}</p>
      </div>
      <template v-if="target.kind === 'task'">
        <UButton v-if="desk" :icon="full ? 'i-lucide-minimize' : 'i-lucide-maximize'" color="neutral" variant="ghost" class="icon-btn" :aria-label="full ? tl('Exit full screen', 'Quitter le plein écran') : tl('Full screen', 'Plein écran')" @click="full = !full" />
        <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" class="icon-btn board-panel-sheet" :aria-label="tl('Task details and actions', 'Fiche et actions de la tâche')" @click="emit('sheet')" />
      </template>
      <UButton
        v-if="desk" icon="i-lucide-x" color="neutral" variant="ghost" size="md" class="icon-btn board-panel-close"
        :aria-label="t('Close')" @click="emit('close')"
      />
    </header>

    <nav v-if="target.kind === 'task'" class="board-panel-tabs" :aria-label="tl('Task views', 'Vues de la tâche')">
      <button v-for="tab in (['chat', 'term', 'task'] as const)" :key="tab" type="button" :class="{ on: selected === tab }" :aria-pressed="selected === tab" :aria-label="tab === 'chat' ? t('Conversation') : tab === 'term' ? t('Terminal') : tl('Task', 'Tâche')" :aria-description="tab === 'task' && newNote ? tl('New task details', 'Nouveaux détails de la tâche') : undefined" :title="tab === 'task' ? undefined : agentHint" @click="selected = tab">
        {{ tab === 'chat' ? t('Conversation') : tab === 'term' ? t('Terminal') : tl('Task', 'Tâche') }}<i v-if="tab === 'task' && newNote" class="task-new" aria-hidden="true" />
      </button>
    </nav>
    <section v-if="target.kind === 'task' && needs" class="task-needs" role="alert">
      <h3>{{ tl('Needs you', 'À toi') }} · {{ failureTitle }}</h3>
      <pre v-if="failureDetail">{{ failureDetail }}</pre>
      <p v-if="details?.failureNext">{{ details.failureNext }}</p>
      <div class="task-needs-actions">
        <UButton v-if="taskPermissions?.retry" :disabled="disabled" @click="taskAction('retry')">{{ tl('Retry', 'Réessayer') }}</UButton>
        <UButton v-if="canFix" :disabled="disabled" @click="taskAction('fix')">{{ tl('Send the error to the agent', 'Envoyer l’erreur à l’agent') }}</UButton>
        <UButton v-if="taskPermissions?.delegate" :disabled="disabled" @click="taskAction('delegate')">{{ tl('Start again', 'Relancer') }}</UButton>
        <UButton v-if="taskPane" :disabled="offlineView || !reachable" @click="selected = 'term'">{{ tl('Open terminal', 'Ouvrir le terminal') }}</UButton>
        <UButton v-if="canAnyway" :disabled="disabled" @click="taskAction('anyway')">{{ tl('Approve anyway', 'Approuver quand même') }}</UButton>
        <UButton v-else-if="taskPermissions?.approve" :disabled="disabled" @click="taskAction('approve')">{{ tl('Approve', 'Approuver') }}</UButton>
      </div>
      <p v-if="readOnly">{{ readOnlyWhy() }}</p>
      <p v-else-if="!reachable">{{ tl('Machine unavailable', 'Machine indisponible') }}</p>
      <p v-if="actionError" class="error">{{ actionError }}</p>
    </section>

    <div class="board-panel-body">
      <TaskSheet v-if="target.kind === 'task' && selected === 'task'" v-model:open="taskOpen" embedded :task="task" :machine="target.machine" :read-only="readOnly" :refresh="refreshTask" @chat="selected = 'chat'" @archived="archivedTask" @restored="restoredTask" />
      <AgentView v-else-if="paneId && (target.kind === 'coordinator' || selected === 'term' || conversation)" :key="paneId" :pane-id="paneId" cell active :embedded="target.kind === 'task'" @update:selected-mode="selected = $event" :selected-mode="target.kind === 'task' ? (selected === 'term' ? 'term' : 'chat') : undefined" />
      <p v-else-if="target.kind === 'task' && loading" class="board-empty board-panel-wait">{{ t('Loading…') }}</p>
      <p v-else-if="failed" class="board-note error board-panel-wait">{{ failed }}</p>
      <div v-else-if="target.kind === 'task'" class="board-panel-start task-setup">
        <h3>{{ details?.failureStage === 'setup' || details?.failureStage === 'start' ? tl('Setup output', 'Sortie du démarrage') : tl('No agent conversation yet', 'Pas encore de conversation avec l’agent') }}</h3>
        <pre v-if="failureDetail && !needs">{{ failureDetail }}</pre>
        <p>{{ tl('The terminal stays available when the task has a pane. Task details and actions are in the Task tab.', 'Le terminal reste accessible quand la tâche a un pane. Les détails et actions sont dans l’onglet Tâche.') }}</p>
        <form v-if="tellOnly" class="board-panel-first board-panel-tell" @submit.prevent="tell">
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
            ? tl(`The message was not sent to ${coordName} on ${machineLabel}.`, `Le message destiné à ${coordName} n’a pas été envoyé sur ${machineLabel}.`)
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
