<script setup lang="ts">
// One herdr-projects task (the Board): what it is, where it stands, its pull
// request and review, and what can be done from here: reply to its agent,
// approve it (merge, or yes to a plan: asked first, it cannot be undone),
// open its agent's pane. What 1.x does not give for a task is not shown.
import { type TaskDetails, type TaskRow, TELL_MAX, prNumber, taskActions } from '#shared/projectsTasks'

const props = defineProps<{ task: TaskRow | null, machine: string }>()
const emit = defineEmits<{ changed: [] }>()
const open = defineModel<boolean>('open', { default: false })

const details = ref<(TaskDetails & { pane: string | null }) | null>(null)
const error = ref('')
const loading = ref(false)
const reply = ref('')
const busy = ref(false)
const actions = computed(() => (props.task ? taskActions(props.task) : { tell: false, approve: false }))
const pr = computed(() => details.value?.pr || props.task?.pr || '')
const review = computed(() => details.value?.review || props.task?.review || null)
const label = computed(() => (props.task ? `${props.task.repo.toUpperCase()}-${props.task.n}` : ''))

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
watch(() => [open.value, props.task?.id], ([o]) => {
  if (!o) return
  details.value = null
  reply.value = ''
  load()
}, { immediate: true })

async function send() {
  const t = props.task
  const text = reply.value.trim()
  if (!t || !text || busy.value) return
  busy.value = true
  try {
    await api('/api/tasks/tell', { machine: props.machine, id: t.id, text })
    reply.value = ''
    haptic()
    toast(tl('Sent to the task’s agent', 'Envoyé à l’agent de la tâche'))
    emit('changed')
  } catch (e) { toast((e as Error).message, true) }
  finally { busy.value = false }
}

async function approve() {
  const t = props.task
  if (!t || busy.value) return
  const plan = t.stage === 'plan'
  const ok = await askConfirm(plan
    ? tl(`Say yes to the plan of “${t.title}”? Its agent starts building.`, `Accepter le plan de « ${t.title} » ? Son agent commence à construire.`)
    : tl(`Approve “${t.title}”? herdr-projects merges its work. This cannot be undone.`, `Approuver « ${t.title} » ? herdr-projects fusionne son travail. C’est irréversible.`),
  plan ? tl('Approve plan', 'Accepter le plan') : tl('Approve and merge', 'Approuver et fusionner'), 'primary')
  if (!ok) return
  busy.value = true
  try {
    const r = await api<{ msg: string }>('/api/tasks/approve', { machine: props.machine, id: t.id })
    toast(r.msg || tl('Approved', 'Approuvé'))
    emit('changed')
    open.value = false
  } catch (e) { toast((e as Error).message, true) }
  finally { busy.value = false }
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

      <dl v-if="details || pr || review" class="task-sheet-facts">
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

      <div v-if="details?.pane || actions.approve" class="task-sheet-actions">
        <UButton v-if="details?.pane" color="neutral" variant="outline" icon="i-lucide-square-terminal" @click="openPane">{{ tl('Open its agent', 'Ouvrir son agent') }}</UButton>
        <UButton v-if="actions.approve" color="primary" icon="i-lucide-check" :loading="busy" :disabled="offlineView" @click="approve">
          {{ task.stage === 'plan' ? tl('Approve plan', 'Accepter le plan') : tl('Approve', 'Approuver') }}
        </UButton>
      </div>

      <form v-if="actions.tell" class="task-sheet-reply" @submit.prevent="send">
        <label for="task-reply">{{ task.stage === 'plan' ? tl('Send the plan back with', 'Renvoyer le plan avec') : tl('Reply to its agent', 'Répondre à son agent') }}</label>
        <UTextarea id="task-reply" v-model="reply" :rows="3" autoresize :maxlength="TELL_MAX" :placeholder="tl('Message', 'Message')" />
        <UButton type="submit" color="primary" icon="i-lucide-send" :loading="busy" :disabled="!reply.trim() || offlineView">{{ t('Send') }}</UButton>
      </form>
    </div>
  </AppSheet>
</template>
