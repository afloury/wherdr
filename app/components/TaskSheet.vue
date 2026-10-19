<script setup lang="ts">
// One herdr-projects task (the Board): what it is, where it stands, its pull
// request and review, and what can be done from here, as 1.x does it: reply
// to its agent, approve it (merge, or yes to a plan: asked first, it cannot be
// undone), start it (a task of the backlog), stop its agent (asked first),
// retry what went wrong, archive it, and open its agent's pane. What 1.x
// does not give for a task is not shown.
import { NO_ACTIONS, type TaskCommand, type TaskDetails, type TaskRow, TELL_MAX, prNumber, taskActions, taskKey } from '#shared/projectsTasks'
import { PROJECTS_LAUNCHER } from '#shared/projectsPlugin'

// `readOnly`: the board is read from its files (wherdr in a container): the
// actions are the host's, given as commands. `inPanel`: opened over the Board's
// side panel, which already shows its agent.
const props = defineProps<{ task: TaskRow | null, machine: string, readOnly?: boolean, inPanel?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const open = defineModel<boolean>('open', { default: false })

const details = ref<(TaskDetails & { pane: string | null }) | null>(null)
const error = ref('')
const loading = ref(false)
const reply = ref('')
const busy = ref(false)
const running = ref<TaskCommand | null>(null)
// A failed task's Retry or Start waits for its details (what failed).
const failure = computed(() => (details.value && details.value.id === props.task?.id ? details.value : null))
const actions = computed(() => (props.task && !props.readOnly ? taskActions(props.task, failure.value) : NO_ACTIONS))
const hostActions = computed(() => (props.task && props.readOnly ? taskActions(props.task, failure.value) : NO_ACTIONS))
const hostCommands = computed(() => (['delegate', 'stop', 'retry', 'archive'] as const).filter(a => hostActions.value[a]))
const pr = computed(() => details.value?.pr || props.task?.pr || '')
const review = computed(() => details.value?.review || props.task?.review || null)
const label = computed(() => (props.task ? taskKey(props.task.id, props.task.repoKey) : ''))

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
// opens again. What a request finishes for an older one (clear the reply, close
// the sheet, end "busy") is not done to the sheet now shown.
let gen = 0
watch([open, target], ([o]) => {
  gen++
  busy.value = false
  running.value = null
  if (!o) return
  details.value = null
  reply.value = ''
  load()
}, { immediate: true })
// The same task moving on (working → failed, …): its details are read again,
// so what it now allows (Retry after a failure) shows without reopening. Kept
// on screen meanwhile; only a real change of stage or state reads again.
const step = () => `${props.task?.stage ?? ''}|${props.task?.state ?? ''}`
watch([target, step], ([t, s], [wasT, wasS]) => {
  if (open.value && t === wasT && s !== wasS) load()
})

async function send() {
  const t = props.task
  const text = reply.value.trim()
  if (!t || !text || busy.value) return
  const g = gen
  busy.value = true
  try {
    await api('/api/tasks/tell', { machine: props.machine, id: t.id, text })
    haptic()
    toast(tl('Sent to the task’s agent', 'Envoyé à l’agent de la tâche'))
    emit('changed')
    if (g === gen) reply.value = ''
  } catch (e) { toast((e as Error).message, true) }
  finally { if (g === gen) busy.value = false }
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
  try {
    const r = await api<{ msg: string }>('/api/tasks/approve', { machine, id: t.id })
    toast(r.msg || tl('Approved', 'Approuvé'))
    emit('changed')
    if (g === gen) open.value = false
  } catch (e) { toast((e as Error).message, true) }
  finally { if (g === gen) busy.value = false }
}

// Start, stop, retry, archive: the task's id only. Stopping is asked first
// (the agent's turn is cut short); archiving can be undone from Herdr.
const ACTION_DONE: Record<TaskCommand, () => string> = {
  delegate: () => tl('Started: an agent is on it', 'Lancée : un agent s’en occupe'),
  stop: () => tl('Stopped', 'Arrêtée'),
  retry: () => tl('Sent back to its agent', 'Renvoyée à son agent'),
  archive: () => tl('Archived', 'Archivée'),
}
async function act(action: TaskCommand) {
  const t = props.task
  if (!t || busy.value) return
  const was = target()
  const machine = props.machine
  if (action === 'stop' && !await askConfirm(
    tl(`Stop the agent of “${t.title}”? Its turn ends now; the task stays, and Retry or Start picks it up again.`, `Arrêter l’agent de « ${t.title} » ? Son tour s’arrête maintenant ; la tâche reste, Réessayer ou Lancer la reprend.`),
    tl('Stop the agent', 'Arrêter l’agent'))) return
  if (!still(was)) return
  const g = gen
  busy.value = true
  running.value = action
  try {
    const r = await api<{ msg: string }>('/api/tasks/action', { machine, id: t.id, action })
    haptic()
    toast(r.msg || ACTION_DONE[action]())
    emit('changed')
    if (action === 'archive' && g === gen) open.value = false
  } catch (e) { toast((e as Error).message, true) }
  finally { if (g === gen) { busy.value = false; running.value = null } }
}

function openPane() {
  const p = details.value?.pane
  if (!p) return
  open.value = false
  navigateTo(panePath(p))
}
</script>

<template>
  <AppSheet v-model:open="open" :title="task?.title || tl('Task', 'Tâche')" wide>
    <div v-if="task" class="task-sheet">
      <p class="task-sheet-meta">
        <span class="task-key">{{ label }}</span>
        <span class="task-state" :class="task.group">{{ taskGroupLabel(task.group) }}</span>
        <span v-if="task.app" class="task-chip">{{ task.app }}</span>
        <span v-if="task.research" class="task-chip">{{ tl('research', 'recherche') }}</span>
        <span v-if="multiMachine && machine !== undefined" class="task-chip">{{ machineName(machine) }}</span>
      </p>
      <p v-if="task.msg" class="task-sheet-msg">{{ task.msg }}</p>

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

      <div v-if="(details?.pane && !inPanel) || actions.approve || actions.delegate || actions.retry || actions.stop || actions.archive" class="task-sheet-actions">
        <UButton v-if="actions.delegate" color="primary" icon="i-lucide-play" :loading="running === 'delegate'" :disabled="busy || offlineView" @click="act('delegate')">{{ tl('Start', 'Lancer') }}</UButton>
        <UButton v-if="actions.approve" color="primary" icon="i-lucide-check" :loading="busy && !running" :disabled="busy || offlineView" @click="approve">
          {{ task.stage === 'plan' ? tl('Approve plan', 'Accepter le plan') : tl('Approve', 'Approuver') }}
        </UButton>
        <UButton v-if="actions.retry" color="primary" variant="outline" icon="i-lucide-rotate-ccw" :loading="running === 'retry'" :disabled="busy || offlineView" @click="act('retry')">{{ tl('Retry', 'Réessayer') }}</UButton>
        <UButton v-if="details?.pane && !inPanel" color="neutral" variant="outline" icon="i-lucide-square-terminal" @click="openPane">{{ tl('Open its agent', 'Ouvrir son agent') }}</UButton>
        <UButton v-if="actions.stop" color="error" variant="outline" icon="i-lucide-square" :loading="running === 'stop'" :disabled="busy || offlineView" @click="act('stop')">{{ tl('Stop', 'Arrêter') }}</UButton>
        <UButton v-if="actions.archive" color="neutral" variant="ghost" icon="i-lucide-archive" class="task-archive" :loading="running === 'archive'" :disabled="busy || offlineView" @click="act('archive')">{{ tl('Archive', 'Archiver') }}</UButton>
      </div>

      <div v-if="hostActions.tell || hostActions.approve || hostCommands.length" class="task-sheet-block">
        <h4>{{ tl('On the host', 'Sur l’hôte') }}</h4>
        <code v-if="hostActions.tell" class="projects-plugin-command">{{ PROJECTS_LAUNCHER }} tell {{ task.id }} "…"</code>
        <code v-if="hostActions.approve" class="projects-plugin-command">{{ PROJECTS_LAUNCHER }} approve {{ task.id }}</code>
        <code v-for="a in hostCommands" :key="a" class="projects-plugin-command">{{ PROJECTS_LAUNCHER }} {{ a }} {{ task.id }}</code>
      </div>
      <form v-if="actions.tell" class="task-sheet-reply" @submit.prevent="send">
        <label for="task-reply">{{ task.stage === 'plan' ? tl('Send the plan back with', 'Renvoyer le plan avec') : tl('Reply to its agent', 'Répondre à son agent') }}</label>
        <UTextarea id="task-reply" v-model="reply" :rows="3" autoresize :maxlength="TELL_MAX" :placeholder="tl('Message', 'Message')" />
        <UButton type="submit" color="primary" icon="i-lucide-send" :loading="busy" :disabled="!reply.trim() || offlineView">{{ t('Send') }}</UButton>
      </form>
    </div>
  </AppSheet>
</template>
