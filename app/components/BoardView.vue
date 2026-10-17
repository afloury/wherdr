<script setup lang="ts">
// The Board: herdr-projects 1.x tasks of every machine, in the five groups of
// its own board (Needs you, Ready to approve, Working, To do, Done). Computer:
// columns side by side; phone: one group at a time under a segmented control.
// A card opens its task (TaskSheet); the box on top talks to a machine's
// Coordinator, which turns what you write into tasks. A machine without
// herdr-projects 1.2.1+ says what to do instead (ProjectsUpgradeNote).
import { TASK_GROUPS, type TaskGroup, type TaskRow, prNumber, sortTasks } from '#shared/projectsTasks'

// Done tasks shown until "Show all".
const DONE_SHOWN = 8
const COLUMN_KEY = 'boardColumn'

const router = useRouter()
const { board, error, reload } = useTasksBoard()

const ready = computed(() => (board.value?.machines || []).filter(m => m.status === 'ready'))
// Machines whose last read failed, or whose tasks are an older read: said, with when.
const troubles = computed(() => (board.value?.machines || []).filter(m => m.error || m.stale))
// Read from the board's files (wherdr in a container): no action from here.
const readOnly = (machine: string) => Boolean(board.value?.machines.find(m => m.machine === machine)?.readOnly)
const writable = computed(() => ready.value.filter(m => !m.readOnly))
const machineLabel = (key: string) => machineName(key) || hostLabel.value || t('This machine')
const readAt = (at?: number) => (at ? new Date(at).toLocaleTimeString(language === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '')
// Machines Herdr answers on but where the Board cannot read herdr-projects.
const notes = computed(() => (board.value?.machines || []).filter(m => m.status === 'missing' || m.status === 'old'))
const disabled = computed(() => (board.value?.machines || []).filter(m => m.status === 'disabled'))
const several = computed(() => (board.value?.machines.length || 0) > 1)

interface Card { key: string, machine: string, task: TaskRow, stale: boolean }
// A machine Herdr did not answer for keeps its last tasks, marked as older.
const cards = computed<Card[]>(() => (board.value?.machines || []).filter(m => m.status === 'ready' || m.tasks.length).flatMap(m => sortTasks(m.tasks.filter(t => !t.archived))
  .map(task => ({ key: `${m.machine}|${task.id}`, machine: m.machine, task, stale: Boolean(m.stale) }))))
const showAll = ref(false)
const columns = computed(() => TASK_GROUPS.map((id) => {
  const all = cards.value.filter(c => c.task.group === id)
  const list = id === 'done' && !showAll.value ? all.slice(0, DONE_SHOWN) : all
  return { id, label: taskGroupLabel(id), total: all.length, cards: list, hidden: all.length - list.length }
}))

// Phone: the group shown, kept on this device.
function readColumn(): TaskGroup {
  try {
    const v = localStorage.getItem(COLUMN_KEY)
    if (TASK_GROUPS.includes(v as TaskGroup)) return v as TaskGroup
  } catch { /* storage unavailable */ }
  return 'needs'
}
const phoneColumn = ref<TaskGroup>(readColumn())
function selectColumn(id: TaskGroup) {
  phoneColumn.value = id
  try { localStorage.setItem(COLUMN_KEY, id) }
  catch { /* storage unavailable */ }
}

// ------------------------------------------------------------ one task
const picked = shallowRef<Card | null>(null)
const sheetOpen = ref(false)
function openCard(c: Card) {
  picked.value = c
  sheetOpen.value = true
}
// The open task as the last read has it (its group or review may have moved on).
const pickedTask = computed(() => {
  const p = picked.value
  return p ? cards.value.find(c => c.key === p.key)?.task || p.task : null
})

// ------------------------------------------------------------ the Coordinator
const coordMachine = ref('')
watch(writable, (list) => {
  if (!list.some(m => m.machine === coordMachine.value)) coordMachine.value = list[0]?.machine ?? ''
}, { immediate: true })
const coordItems = computed(() => writable.value.map(m => ({ label: machineLabel(m.machine), value: m.machine })))
const coordText = ref('')
const coordBusy = ref(false)
async function tellCoordinator() {
  const text = coordText.value.trim()
  if (!text || coordBusy.value || !writable.value.length) return
  coordBusy.value = true
  try {
    await api('/api/tasks/coordinator', { machine: coordMachine.value, text })
    coordText.value = ''
    haptic()
    toast(tl('Sent to the Coordinator', 'Envoyé au Coordinateur'))
    setTimeout(reload, 3000)
  } catch (e) { toast((e as Error).message, true) }
  finally { coordBusy.value = false }
}

const meta = (task: TaskRow) => [task.app, task.progress !== null && task.group === 'working' ? `${task.progress}%` : ''].filter(Boolean)

function back() {
  const from = (history.state as { back?: unknown } | null)?.back
  if (typeof from === 'string' && from.startsWith('/') && from !== '/board') router.back()
  else navigateTo('/', { replace: true })
}
</script>

<template>
  <section id="board" class="view board-view">
    <header class="top bar board-top">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Back')" @click="back" />
      <h2>{{ t('Board') }}</h2>
      <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="lg" class="icon-btn board-filter" :aria-label="tl('Refresh', 'Actualiser')" :disabled="offlineView" @click="reload" />
    </header>
    <div v-if="error" class="notice board-notice">{{ error }}</div>
    <p v-else-if="!board && !offlineView" class="board-empty board-loading">{{ t('Loading…') }}</p>

    <div v-if="notes.length || disabled.length || troubles.length || ready.some(m => m.readOnly)" class="board-notes">
      <p v-for="m in troubles" :key="`e-${m.machine}`" class="board-note error" role="alert">
        <b>{{ several ? machineLabel(m.machine) : tl('herdr-projects', 'herdr-projects') }}</b> · {{ m.error || tl('No answer yet', 'Pas encore de réponse') }}<template v-if="m.stale && m.at"> · {{ tl(`tasks as read at ${readAt(m.at)}`, `tâches lues à ${readAt(m.at)}`) }}</template>
      </p>
      <p v-for="m in ready.filter(x => x.readOnly)" :key="`r-${m.machine}`" class="board-note">
        {{ tl('wherdr runs in a container: the Board reads herdr-projects’ files and runs nothing here (its upkeep belongs to the host). Reply, approve and the Coordinator: from Herdr on the host, or with herdr-projects there.', 'wherdr tourne dans un conteneur : le Board lit les fichiers de herdr-projects et n’y lance rien (son entretien revient à l’hôte). Répondre, approuver et le Coordinateur : depuis Herdr sur l’hôte, ou avec herdr-projects là-bas.') }}
      </p>
      <ProjectsUpgradeNote
        v-for="m in notes" :key="m.machine" :status="m.status as 'missing' | 'old'" :version="m.version || null"
        :machine="several ? (machineName(m.machine) || hostLabel || t('This machine')) : undefined"
      />
      <p v-for="m in disabled" :key="m.machine" class="board-note">{{ tl(`herdr-projects is disabled in Herdr${several ? ` on ${machineName(m.machine)}` : ''}: herdr plugin enable herdr-projects`, `herdr-projects est désactivé dans Herdr${several ? ` sur ${machineName(m.machine)}` : ''} : herdr plugin enable herdr-projects`) }}</p>
    </div>

    <template v-if="ready.length || cards.length">
      <form v-if="writable.length" class="board-coord" @submit.prevent="tellCoordinator">
        <label for="board-coord-text" class="board-coord-label">{{ tl('Coordinator', 'Coordinateur') }}</label>
        <USelect v-if="writable.length > 1" v-model="coordMachine" :items="coordItems" size="sm" class="board-coord-machine" :aria-label="tl('Machine', 'Machine')" />
        <UInput
          id="board-coord-text" v-model="coordText" class="board-coord-input" :disabled="offlineView" maxlength="8000"
          :placeholder="tl('Describe work to add as tasks…', 'Décris le travail à ajouter en tâches…')"
        />
        <UButton type="submit" color="primary" icon="i-lucide-send" :loading="coordBusy" :disabled="!coordText.trim() || offlineView" :aria-label="t('Send')" />
      </form>

      <div v-if="!desk" class="board-seg tasks" role="group" :aria-label="t('Board')">
        <button
          v-for="col in columns" :key="col.id" type="button" class="board-seg-btn" :class="[col.id, { on: phoneColumn === col.id }]"
          :aria-pressed="phoneColumn === col.id" @click="selectColumn(col.id)"
        >
          <span>{{ col.label }}</span><b>{{ col.total }}</b>
        </button>
      </div>
      <div class="board-cols">
        <section v-for="col in columns" v-show="desk || phoneColumn === col.id" :key="col.id" class="board-col" :class="col.id" :aria-label="col.label">
          <h3 v-if="desk" class="board-col-head"><span>{{ col.label }}</span><span class="pp-count">{{ col.total }}</span></h3>
          <div class="board-col-body">
            <button v-for="c in col.cards" :key="c.key" type="button" class="board-card task-card" :class="[c.task.group, { stale: c.stale }]" :title="c.stale ? tl('An older read: see the note above', 'Lecture plus ancienne : voir la note plus haut') : undefined" @click="openCard(c)">
              <span class="board-card-head">
                <span class="task-key">{{ c.task.repo.toUpperCase() }}-{{ c.task.n }}</span>
                <span v-if="several" class="board-card-label">{{ machineName(c.machine) }}</span>
              </span>
              <span class="board-card-title wrap">{{ c.task.title }}</span>
              <span v-if="c.task.msg" class="board-note">{{ c.task.msg }}</span>
              <span v-if="meta(c.task).length || c.task.pr || c.task.review" class="task-chips">
                <span v-for="m in meta(c.task)" :key="m" class="task-chip">{{ m }}</span>
                <span v-if="c.task.pr" class="task-chip">{{ prNumber(c.task.pr) || 'PR' }}</span>
                <span v-if="c.task.review" class="task-chip" :class="c.task.review.pass === false ? 'fail' : c.task.review.pass ? 'pass' : ''">
                  {{ c.task.review.pass === false ? tl('review failed', 'revue échouée') : tl('review', 'revue') }}{{ c.task.review.tally ? ` · ${c.task.review.tally}` : '' }}
                </span>
              </span>
            </button>
            <p v-if="!col.cards.length" class="board-empty">{{ t('Nothing here') }}</p>
            <button v-if="col.hidden" type="button" class="board-more" @click="showAll = true">
              {{ tl(`Show all (${col.hidden} more)`, `Tout afficher (${col.hidden} de plus)`) }}
            </button>
          </div>
        </section>
      </div>
    </template>
    <TaskSheet v-model:open="sheetOpen" :task="pickedTask" :machine="picked?.machine ?? ''" :read-only="readOnly(picked?.machine ?? '')" @changed="reload" />
  </section>
</template>
