<script setup lang="ts">
// One herdr-projects task (the Board): what it is, where it stands, its pull
// request and review, and what can be done from here, as 1.x does it: approve
// it (merge, or yes to a plan: asked first, it cannot be undone), start it (a
// task of the backlog), stop its agent (asked first), retry what went wrong,
// archive it. What 1.x does not give for a task is not shown.
// Start names the agent the task starts with by default (its worker.agent, and
// where that comes from) and offers the other agents installed on its machine:
// a pick is for this start only (`delegate --worker.agent`), the defaults stay.
// No message field here: "Open the chat" closes the sheet and opens the task's
// agent in the Board's side panel (`chat`), where replying happens (with no
// pane for its agent, the panel's field sends the reply through herdr-projects).
// After an action (Approve included) the sheet shows where the task now
// stands: the Board and the task's details are read again before its buttons
// come back, or the error stays in the sheet. Archive closes it: the Board
// offers Restore for a few seconds. An archived task (Board › Archived, a link to it) is read-only, as
// in 1.x: an "Archived" tag and Restore, nothing else.
import { NO_ACTIONS, type StartOptions, type TaskCommand, type TaskDetails, type TaskRow, prNumber, taskActions, taskKey } from '#shared/projectsTasks'
import { PROJECTS_LAUNCHER } from '#shared/projectsPlugin'

// `readOnly`: the board is read from its files (wherdr in a container): the
// actions are the host's, given as commands.
// `refresh`: reads the Board again (its promise ends with the read); without
// it, `changed` asks for that. `archived` / `restored`: the task was put away
// or brought back from here.
// `chat`: open this task's agent in the side panel (the sheet has closed).
const props = defineProps<{ task: TaskRow | null, machine: string, readOnly?: boolean, refresh?: () => Promise<unknown> }>()
const emit = defineEmits<{ changed: [], archived: [machine: string, task: TaskRow], restored: [machine: string, task: TaskRow], chat: [machine: string, task: TaskRow] }>()
const open = defineModel<boolean>('open', { default: false })

const details = ref<(TaskDetails & { pane: string | null }) | null>(null)
const error = ref('')
const loading = ref(false)
const busy = ref(false)
const running = ref<TaskCommand | null>(null)
// Why the last action failed, kept in the sheet (a toast goes away).
const actionError = ref('')
// A failed task's Retry or Start waits for its details (what failed).
const failure = computed(() => (details.value && details.value.id === props.task?.id ? details.value : null))
// Archived: as its details (its file) or its row say, until Restore from here.
const restored = ref(false)
const archived = computed(() => Boolean(failure.value?.archived) || (Boolean(props.task?.archived) && !restored.value))
const row = computed(() => (props.task ? { ...props.task, archived: archived.value } : null))
const actions = computed(() => (row.value && !props.readOnly ? taskActions(row.value, failure.value) : NO_ACTIONS))
const hostActions = computed(() => (row.value && props.readOnly ? taskActions(row.value, failure.value) : NO_ACTIONS))
const hostCommands = computed(() => (['delegate', 'stop', 'retry', 'archive', 'restore'] as const).filter(a => hostActions.value[a]))
const pr = computed(() => details.value?.pr || props.task?.pr || '')
const review = computed(() => details.value?.review || props.task?.review || null)
const label = computed(() => (props.task ? taskKey(props.task.id, props.task.repoKey) : ''))
// Offered when it has an agent to talk to (its pane, as its details name it),
// or one herdr-projects takes a reply for (`tell`), pane or not.
const chatShown = computed(() => !archived.value && (Boolean(failure.value?.pane) || actions.value.tell))

// Start: the task's default agent and the installed ones (`/api/tasks/start`),
// read when the sheet offers Start. `pick`: another agent for this start; null
// is the default, which sends no agent at all (Start exactly as before).
const startOpts = ref<StartOptions | null>(null)
const startLoading = ref(false)
const pick = ref<string | null>(null)
const defaultKind = computed(() => startOpts.value?.agent?.kind || '')
// The default first (as herdr-projects resolves it, model included), then the others.
// The default is offered only where it is installed. Unknown (no agent found:
// the machine could not be checked) it stays what Start does, as before.
const defaultUsable = computed(() => {
  const o = startOpts.value
  return !o?.agent || !o.agents.length || o.agents.includes(o.agent.kind)
})
const startAgents = computed(() => {
  const o = startOpts.value
  if (!o) return []
  return [
    { id: null as string | null, label: o.agent?.value || tl('default', 'par défaut'), isDefault: true, usable: defaultUsable.value },
    ...o.agents.filter(k => k !== defaultKind.value).map(k => ({ id: k as string | null, label: k, isDefault: false, usable: true })),
  ]
})
const startAgent = computed(() => (pick.value && pick.value !== defaultKind.value ? pick.value : null))
// The default is not installed there: Start waits for another agent.
const needsPick = computed(() => !defaultUsable.value && !startAgent.value)
const checked = (a: { id: string | null, isDefault: boolean, usable: boolean }) => (a.isDefault ? a.usable && !startAgent.value : a.id === startAgent.value)
// Where the default comes from, in the user's words (1.x's own as a fallback).
function agentSource(): string {
  const a = startOpts.value?.agent
  if (!a) return ''
  const repo = props.task?.repo || ''
  switch (a.place) {
    case 'task': return tl('Default set on this task', 'Défaut réglé sur cette tâche')
    case 'repo': return tl(`Default from your settings for ${repo}`, `Défaut de tes réglages pour ${repo}`)
    case 'you': return tl('Default from your settings', 'Défaut de tes réglages')
    case 'builtin': return tl('herdr-projects’ built-in default', 'Défaut intégré de herdr-projects')
    default: return tl(`Default: ${a.from}`, `Défaut : ${a.from}`)
  }
}
let startSeq = 0
async function loadStart() {
  const t = props.task
  if (!t) return
  const id = ++startSeq
  startLoading.value = true
  try {
    const o = await api<StartOptions>(`/api/tasks/start?machine=${encodeURIComponent(props.machine)}&id=${encodeURIComponent(t.id)}`)
    if (id === startSeq) startOpts.value = o
  } catch {
    // Start still works with the task's default: only the choice is missing.
    if (id === startSeq) startOpts.value = null
  } finally {
    if (id === startSeq) startLoading.value = false
  }
}

let seq = 0
async function load() {
  const t = props.task
  if (!t) return
  const id = ++seq
  loading.value = true
  error.value = ''
  try {
    const d = await api<TaskDetails & { pane: string | null }>(`/api/tasks/details?machine=${encodeURIComponent(props.machine)}&id=${encodeURIComponent(t.id)}`)
    if (id === seq) details.value = d
  } catch (e) {
    if (id === seq) error.value = (e as Error).message
  } finally {
    if (id === seq) loading.value = false
  }
}
// By the task itself, its machine and its id: each read of the Board gives a
// new row, which must not empty the sheet back to "Loading…" under the user's
// finger; the same id on another machine is another task, whose sheet starts
// empty (no details, no words written for the other one).
const target = () => `${props.machine}|${props.task?.id ?? ''}`
// The sheet's generation: a new one each time it shows another task, closes or
// opens again. What a request finishes for an older one (close
// the sheet, end "busy") is not done to the sheet now shown.
let gen = 0
watch([open, target], ([o]) => {
  gen++
  busy.value = false
  running.value = null
  actionError.value = ''
  restored.value = false
  pick.value = null
  startOpts.value = null
  startLoading.value = false
  startSeq++
  if (!o) return
  details.value = null
  load()
}, { immediate: true })
// Asked once per sheet, when it offers Start (a failed task may offer it only
// once its details say what failed).
// Watched after the reset above, so another task's sheet asks again.
watch(() => `${open.value && actions.value.delegate}|${target()}`, () => {
  if (open.value && actions.value.delegate && !startOpts.value && !startLoading.value) loadStart()
}, { immediate: true })
// The same task moving on (working → failed, …): its details are read again,
// so what it now allows (Retry after a failure) shows without reopening. Kept
// on screen meanwhile; only a real change of stage or state reads again.
const step = () => `${props.task?.stage ?? ''}|${props.task?.state ?? ''}`
watch([target, step], ([t, s], [wasT, wasS]) => {
  if (open.value && t === wasT && s !== wasS) load()
})

// After an action: the Board, then the task's details, read again, so the
// sheet shows what the task now allows before its buttons come back.
async function settle(g: number) {
  if (props.refresh) await props.refresh().catch(() => {})
  else emit('changed')
  if (g === gen && open.value) await load()
}
function failed(e: unknown, g: number) {
  const msg = (e as Error).message
  toast(msg, true)
  if (g === gen) actionError.value = msg
}

// Still the task the user was asked about (a push or a card may have shown
// another meanwhile): nothing is sent for it otherwise.
const still = (was: string) => open.value && target() === was

async function approve() {
  const t = props.task
  if (!t || busy.value) return
  const was = target()
  const machine = props.machine
  const plan = t.stage === 'plan'
  const ok = await askConfirm(plan
    ? tl(`Say yes to the plan of “${t.title}”? Its agent starts building.`, `Accepter le plan de « ${t.title} » ? Son agent commence à construire.`)
    : tl(`Approve “${t.title}”? herdr-projects merges its work. This cannot be undone.`, `Approuver « ${t.title} » ? herdr-projects fusionne son travail. C’est irréversible.`),
  plan ? tl('Approve plan', 'Accepter le plan') : tl('Approve and merge', 'Approuver et fusionner'), 'primary')
  if (!ok || !still(was)) return
  const g = gen
  busy.value = true
  actionError.value = ''
  try {
    const r = await api<{ msg: string }>('/api/tasks/approve', { machine, id: t.id })
    toast(r.msg || tl('Approved', 'Approuvé'))
    // The sheet stays: it shows where the task now stands (merging, building the plan…).
    await settle(g)
  } catch (e) { failed(e, g) }
  finally { if (g === gen) busy.value = false }
}

// Start, stop, retry, archive, restore: the task's id only. Stopping is asked
// first (the agent's turn is cut short); archiving is undone by Restore, which
// the Board offers right after it.
const ACTION_DONE: Record<Exclude<TaskCommand, 'archive'>, () => string> = {
  delegate: () => tl('Started: an agent is on it', 'Lancée : un agent s’en occupe'),
  stop: () => tl('Stopped', 'Arrêtée'),
  retry: () => tl('Sent back to its agent', 'Renvoyée à son agent'),
  restore: () => tl('Restored', 'Restaurée'),
}
async function act(action: TaskCommand) {
  const t = props.task
  if (!t || busy.value) return
  if (action === 'delegate' && needsPick.value) return
  const was = target()
  const machine = props.machine
  if (action === 'stop' && !await askConfirm(
    tl(`Stop the agent of “${t.title}”? Its turn ends now; the task stays, and Retry or Start picks it up again.`, `Arrêter l’agent de « ${t.title} » ? Son tour s’arrête maintenant ; la tâche reste, Réessayer ou Lancer la reprend.`),
    tl('Stop the agent', 'Arrêter l’agent'))) return
  if (!still(was)) return
  const g = gen
  busy.value = true
  running.value = action
  actionError.value = ''
  try {
    const agent = action === 'delegate' ? startAgent.value : null
    const r = await api<{ msg: string }>('/api/tasks/action', { machine, id: t.id, action, ...(agent ? { agent } : {}) })
    haptic()
    if (action === 'archive') {
      // The Board says it, with Restore, and reads itself again.
      if (g === gen) open.value = false
      emit('archived', machine, t)
      return
    }
    toast(r.msg || ACTION_DONE[action]())
    if (action === 'restore' && g === gen) restored.value = true
    if (action === 'restore') emit('restored', machine, t)
    await settle(g)
  } catch (e) { failed(e, g) }
  finally { if (g === gen) { busy.value = false; running.value = null } }
}

// The task's conversation in the Board's side panel, the sheet closed.
function chat() {
  const t = props.task
  if (!t || !chatShown.value) return
  open.value = false
  emit('chat', props.machine, t)
}
</script>

<template>
  <AppSheet v-model:open="open" :title="task?.title || tl('Task', 'Tâche')" wide>
    <div v-if="task" class="task-sheet">
      <p class="task-sheet-meta">
        <span class="task-key">{{ label }}</span>
        <span class="task-state" :class="task.group">{{ taskGroupLabel(task.group) }}</span>
        <span v-if="archived" class="task-chip task-archived"><UIcon name="i-lucide-archive" />{{ tl('Archived', 'Archivée') }}</span>
        <span v-if="task.app" class="task-chip">{{ task.app }}</span>
        <span v-if="task.research" class="task-chip">{{ tl('research', 'recherche') }}</span>
        <span v-if="multiMachine && machine !== undefined" class="task-chip">{{ machineName(machine) }}</span>
      </p>
      <p v-if="task.msg" class="task-sheet-msg">{{ task.msg }}</p>
      <p v-if="archived" class="board-note task-sheet-archived">{{ tl('Archived: read-only, as in herdr-projects. Restore it to change or start it again.', 'Archivée : en lecture seule, comme dans herdr-projects. Restaure-la pour la modifier ou la relancer.') }}</p>

      <p v-if="loading && !details" class="board-empty">{{ t('Loading…') }}</p>
      <p v-if="error" class="board-note error">{{ error }}</p>

      <dl v-if="pr || review || details?.branch || details?.agent" class="task-sheet-facts">
        <template v-if="pr">
          <dt>{{ tl('Pull request', 'Pull request') }}</dt>
          <dd><a :href="pr" target="_blank" rel="noopener noreferrer">{{ prNumber(pr) || 'PR' }} <UIcon name="i-lucide-external-link" /></a></dd>
        </template>
        <template v-if="review">
          <dt>{{ tl('Review', 'Revue') }}{{ task.reviewRound > 1 ? ` · R${task.reviewRound}` : '' }}</dt>
          <dd :class="review.pass === false ? 'fail' : review.pass ? 'pass' : ''">
            {{ review.pass === false ? tl('Fail', 'Échec') : review.pass ? tl('Pass', 'Validée') : '' }}{{ review.tally ? ` · ${review.tally}` : '' }}{{ review.by ? ` · ${review.by}` : '' }}
          </dd>
        </template>
        <template v-if="details?.branch">
          <dt>{{ tl('Branch', 'Branche') }}</dt>
          <dd class="mono">{{ details.branch }}</dd>
        </template>
        <template v-if="details?.agent">
          <dt>{{ tl('Agent', 'Agent') }}</dt>
          <dd>{{ details.agent }}</dd>
        </template>
      </dl>
      <div v-if="details?.failure" class="plugin-input-note warn">
        <UIcon name="i-lucide-triangle-alert" />
        <p>{{ details.failure }}</p>
      </div>
      <section v-if="details?.description" class="task-sheet-block">
        <h4>{{ tl('Description', 'Description') }}</h4>
        <p class="task-sheet-text">{{ details.description }}</p>
      </section>
      <section v-if="details?.plan" class="task-sheet-block">
        <h4>{{ tl('Plan', 'Plan') }}</h4>
        <p class="task-sheet-text">{{ details.plan }}</p>
      </section>

      <div v-if="actions.delegate" class="task-start-agent" role="radiogroup" :aria-label="tl('Agent for this start', 'Agent pour ce lancement')">
        <span class="task-start-label">{{ tl('Agent', 'Agent') }}</span>
        <span v-if="!startOpts" class="task-start-wait">{{ startLoading ? t('Loading…') : tl('the task’s default', 'celui de la tâche par défaut') }}</span>
        <button
          v-for="a in startAgents" :key="a.id ?? ''" type="button" role="radio" class="task-start-chip"
          :class="{ on: checked(a), off: !a.usable }"
          :aria-checked="checked(a)"
          :disabled="busy || offlineView || !a.usable" @click="pick = a.id"
        >
          <AgentAvatar v-if="a.id || startOpts?.agent" :agent="a.id || defaultKind" /><span class="task-start-name">{{ a.label }}</span><small v-if="a.isDefault">{{ a.usable ? tl('default', 'défaut') : tl('default · not installed', 'défaut · pas installé') }}</small>
        </button>
        <span v-if="startOpts?.agent" class="task-start-from">{{ agentSource() }}</span>
        <span v-if="needsPick" class="task-start-from task-start-missing" role="status">{{ tl(`${defaultKind} is not installed on this machine: pick another agent to start it.`, `${defaultKind} n’est pas installé sur cette machine : choisis un autre agent pour la lancer.`) }}</span>
        <span v-if="startAgent" class="task-start-from">{{ tl('For this start only: the default stays.', 'Pour ce lancement seulement : le défaut ne change pas.') }}</span>
      </div>
      <div v-if="chatShown || actions.approve || actions.delegate || actions.retry || actions.stop || actions.archive || actions.restore" class="task-sheet-actions">
        <UButton v-if="actions.restore" color="primary" icon="i-lucide-archive-restore" :loading="running === 'restore'" :disabled="busy || offlineView" @click="act('restore')">{{ tl('Restore', 'Restaurer') }}</UButton>
        <UButton v-if="actions.delegate" color="primary" icon="i-lucide-play" :loading="running === 'delegate'" :disabled="busy || offlineView || needsPick" @click="act('delegate')">{{ startAgent ? tl(`Start with ${startAgent}`, `Lancer avec ${startAgent}`) : tl('Start', 'Lancer') }}</UButton>
        <UButton v-if="actions.approve" color="primary" icon="i-lucide-check" :loading="busy && !running" :disabled="busy || offlineView" @click="approve">
          {{ task.stage === 'plan' ? tl('Approve plan', 'Accepter le plan') : tl('Approve', 'Approuver') }}
        </UButton>
        <UButton v-if="actions.retry" color="primary" variant="outline" icon="i-lucide-rotate-ccw" :loading="running === 'retry'" :disabled="busy || offlineView" @click="act('retry')">{{ tl('Retry', 'Réessayer') }}</UButton>
        <UButton
          v-if="chatShown" class="task-chat" color="neutral" variant="outline" icon="i-lucide-message-square"
          @click="chat"
        >
          {{ tl('Open the chat', 'Ouvrir la discussion') }}
        </UButton>
        <UButton v-if="actions.stop" color="error" variant="outline" icon="i-lucide-square" :loading="running === 'stop'" :disabled="busy || offlineView" @click="act('stop')">{{ tl('Stop', 'Arrêter') }}</UButton>
        <UButton v-if="actions.archive" color="neutral" variant="ghost" icon="i-lucide-archive" class="task-archive" :loading="running === 'archive'" :disabled="busy || offlineView" @click="act('archive')">{{ tl('Archive', 'Archiver') }}</UButton>
      </div>
      <p v-if="actionError" class="board-note error task-sheet-error" role="alert">{{ actionError }}</p>

      <!-- wherdr in a container: the same actions, off, each saying why on hover. -->
      <div v-if="hostActions.tell || hostActions.approve || hostCommands.length" class="task-sheet-actions task-sheet-ro">
        <span v-if="hostActions.delegate" class="ro-why" :title="readOnlyWhy()"><UButton color="primary" icon="i-lucide-play" disabled :aria-description="readOnlyWhy()">{{ tl('Start', 'Lancer') }}</UButton></span>
        <span v-if="hostActions.approve" class="ro-why" :title="readOnlyWhy()">
          <UButton color="primary" icon="i-lucide-check" disabled :aria-description="readOnlyWhy()">{{ task.stage === 'plan' ? tl('Approve plan', 'Accepter le plan') : tl('Approve', 'Approuver') }}</UButton>
        </span>
        <span v-if="hostActions.retry" class="ro-why" :title="readOnlyWhy()"><UButton color="primary" variant="outline" icon="i-lucide-rotate-ccw" disabled :aria-description="readOnlyWhy()">{{ tl('Retry', 'Réessayer') }}</UButton></span>
        <span v-if="hostActions.tell" class="ro-why" :title="readOnlyWhy()"><UButton color="neutral" variant="outline" icon="i-lucide-send" disabled :aria-description="readOnlyWhy()">{{ tl('Reply', 'Répondre') }}</UButton></span>
        <span v-if="hostActions.stop" class="ro-why" :title="readOnlyWhy()"><UButton color="error" variant="outline" icon="i-lucide-square" disabled :aria-description="readOnlyWhy()">{{ tl('Stop', 'Arrêter') }}</UButton></span>
        <span v-if="hostActions.archive" class="ro-why" :title="readOnlyWhy()"><UButton color="neutral" variant="ghost" icon="i-lucide-archive" disabled :aria-description="readOnlyWhy()">{{ tl('Archive', 'Archiver') }}</UButton></span>
        <span v-if="hostActions.restore" class="ro-why" :title="readOnlyWhy()"><UButton color="primary" icon="i-lucide-archive-restore" disabled :aria-description="readOnlyWhy()">{{ tl('Restore', 'Restaurer') }}</UButton></span>
      </div>
      <div v-if="hostActions.tell || hostActions.approve || hostCommands.length" class="task-sheet-block">
        <h4>{{ tl('On the host', 'Sur l’hôte') }}</h4>
        <code v-if="hostActions.tell" class="projects-plugin-command">{{ PROJECTS_LAUNCHER }} tell {{ task.id }} "…"</code>
        <code v-if="hostActions.approve" class="projects-plugin-command">{{ PROJECTS_LAUNCHER }} approve {{ task.id }}</code>
        <code v-for="a in hostCommands" :key="a" class="projects-plugin-command">{{ PROJECTS_LAUNCHER }} {{ a }} {{ task.id }}</code>
      </div>
    </div>
  </AppSheet>
</template>
