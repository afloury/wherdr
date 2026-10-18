<script setup lang="ts">
// The Board: herdr-projects 1.x tasks of every machine. By default every
// machine, grouped by machine then by repo (1.x: `Alt+M` with `Alt+S`); or in
// the five groups of its board (Needs you, Ready to approve, Working, To do,
// Done): columns on a computer, one group at a time on a phone.
//
// Talking to agents happens in a side panel (BoardPanel), never in a box on the
// Board: a card opens its task's agent there, a machine's heading that
// machine's Coordinator, a repo's heading that repo's project coordinator
// (1.x: `Space` on a heading). A task with no agent opens its sheet
// (TaskSheet), which the panel opens too; "+ New task" adds one (NewTaskSheet).
// A machine without herdr-projects 1.2.1+ says what to do instead
// (ProjectsUpgradeNote).
//
// What is kept on this device only: the machine shown, the grouping, folded
// headings. Nothing about the projects themselves: that is herdr-projects'.
import {
  type CoordinatorTarget, TASK_GROUPS, type TaskGroup, type TaskRow, groupByRepo, groupCounts, sortTasks,
} from '#shared/projectsTasks'
import type { PanelTarget } from './BoardPanel.vue'

// Done tasks shown until "Show all": per column, and per repo.
const DONE_SHOWN = 8
const DONE_SHOWN_REPO = 3
const COLUMN_KEY = 'boardColumn'
const SCOPE_KEY = 'boardMachine'
const GROUPING_KEY = 'boardGrouping'
const FOLDS_KEY = 'boardFolds'
const ALL = '*'

const router = useRouter()
const route = useRoute()
const { board, error, reads, reload } = useTasksBoard()

const readStore = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const writeStore = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } }

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

// ------------------------------------------------------------ what is shown
// The machines with a board (or tasks from an earlier read), in Herdr's order.
const boards = computed(() => (board.value?.machines || []).filter(m => m.status === 'ready' || m.tasks.length))
const scope = ref(readStore(SCOPE_KEY) || ALL)
// A machine that went away: every machine again.
const shownScope = computed(() => (scope.value !== ALL && boards.value.some(m => m.machine === scope.value) ? scope.value : ALL))
const scopeItems = computed(() => [{ label: tl('All machines', 'Toutes les machines'), value: ALL }, ...boards.value.map(m => ({ label: machineLabel(m.machine), value: m.machine }))])
function pickScope(v: string) {
  scope.value = v
  writeStore(SCOPE_KEY, v)
}
const shownBoards = computed(() => boards.value.filter(m => shownScope.value === ALL || m.machine === shownScope.value))

type Grouping = 'repo' | 'status'
const grouping = ref<Grouping>(readStore(GROUPING_KEY) === 'status' ? 'status' : 'repo')
function pickGrouping(g: Grouping) {
  grouping.value = g
  writeStore(GROUPING_KEY, g)
}

interface Card { key: string, machine: string, task: TaskRow, stale: boolean, readAt?: number }
const cardOf = (m: { machine: string, stale?: boolean, at?: number }, task: TaskRow): Card =>
  ({ key: `${m.machine}|${task.id}`, machine: m.machine, task, stale: Boolean(m.stale || task.stale), readAt: task.stale ? task.readAt : m.at })
// A machine Herdr did not answer for keeps its last tasks, marked as older.
const allCards = computed<Card[]>(() => boards.value.flatMap(m => sortTasks(m.tasks.filter(t => !t.archived)).map(task => cardOf(m, task))))
const cards = computed(() => allCards.value.filter(c => shownScope.value === ALL || c.machine === shownScope.value))
const showAll = ref(false)
const columns = computed(() => TASK_GROUPS.map((id) => {
  const all = cards.value.filter(c => c.task.group === id)
  const list = id === 'done' && !showAll.value ? all.slice(0, DONE_SHOWN) : all
  return { id, label: taskGroupLabel(id), total: all.length, cards: list, hidden: all.length - list.length }
}))

// Folded headings (`m:<machine>`, `r:<machine>|<repo>`), on this device.
const folds = ref(new Set<string>((() => { try { return JSON.parse(readStore(FOLDS_KEY) || '[]') as string[] } catch { return [] } })()))
function fold(key: string) {
  const next = new Set(folds.value)
  if (!next.delete(key)) next.add(key)
  folds.value = next
  writeStore(FOLDS_KEY, JSON.stringify([...next].slice(-200)))
}

// What a heading holds, in a few words: what needs you first, done left out.
function summary(rows: TaskRow[]): string {
  const c = groupCounts(rows)
  const parts = (['needs', 'ready', 'working', 'todo'] as const).filter(g => c[g]).map(g => `${c[g]} ${taskGroupLabel(g).toLowerCase()}`)
  return parts.join(' · ') || (c.done ? tl(`${c.done} done`, `${c.done} fait${c.done > 1 ? 's' : ''}`) : tl('no task', 'aucune tâche'))
}
const machineGroups = computed(() => shownBoards.value.map((m) => {
  const rows = m.tasks.filter(t => !t.archived)
  return {
    machine: m.machine,
    summary: summary(rows),
    readOnly: Boolean(m.readOnly),
    repos: groupByRepo(rows).map(({ repo, tasks }) => {
      // The board's five groups under each repo, as "By status" shows them.
      const cols = TASK_GROUPS.map((id) => {
        const all = tasks.filter(t => t.group === id)
        const list = id === 'done' && !showAll.value ? all.slice(0, DONE_SHOWN_REPO) : all
        return { id, label: taskGroupLabel(id), total: all.length, cards: list.map(task => cardOf(m, task)), hidden: all.length - list.length }
      })
      // An empty group keeps a narrow track: its name and its 0.
      const tracks = cols.map(c => (c.total ? 'minmax(0, 1fr)' : '96px')).join(' ')
      return { repo, summary: summary(tasks), cols, tracks }
    }),
  }
}))
// Each machine's repos, as its tasks show them: the choices of "+ New task".
const reposByMachine = computed(() => Object.fromEntries(boards.value.map(m => [m.machine, [...new Set(m.tasks.map(t => t.repo))].sort()])))

// Columns side by side need room: on a phone, or a Board narrowed by the side
// panel, each repo's groups are stacked sections and "By status" one group at
// a time.
const root = ref<HTMLElement | null>(null)
const width = ref(0)
let sizes: ResizeObserver | null = null
onMounted(() => {
  if (!root.value || typeof ResizeObserver === 'undefined') return
  sizes = new ResizeObserver(([e]) => { width.value = e!.contentRect.width })
  sizes.observe(root.value)
})
onUnmounted(() => sizes?.disconnect())
const wide = computed(() => desk.value && (!width.value || width.value >= 760))

// Phone: the group shown, kept on this device.
function readColumn(): TaskGroup {
  const v = readStore(COLUMN_KEY)
  return TASK_GROUPS.includes(v as TaskGroup) ? v as TaskGroup : 'needs'
}
const phoneColumn = ref<TaskGroup>(readColumn())
function selectColumn(id: TaskGroup) {
  phoneColumn.value = id
  writeStore(COLUMN_KEY, id)
}

// ------------------------------------------------------------ one task
const picked = shallowRef<Card | null>(null)
const sheetOpen = ref(false)
function openSheet(c: Card) {
  picked.value = c
  sheetOpen.value = true
}
// A card: its agent in the panel; a task with no agent program on it (to do,
// one that never started): its sheet at once. The panel asks for the sheet too
// when the task's agent is gone.
function openCard(c: Card) {
  if (!c.task.app) {
    panel.value = null
    return openSheet(c)
  }
  picked.value = c
  panel.value = { machine: c.machine, kind: 'task', id: c.task.id }
  haptic()
}
// The open task as the last read has it (its group or review may have moved on).
const pickedTask = computed(() => {
  const p = picked.value
  return p ? allCards.value.find(c => c.key === p.key)?.task || p.task : null
})
// A push about a task opens it: `#/board?machine=<key>&task=<repo>/<n>`. The
// same id can be on two machines: only that machine's task opens (a link with
// no machine: the one card with that id). The kept board may predate the task,
// so nothing is concluded before a read of this visit; a machine that cannot be
// read keeps the request until it answers.
const opening = ref<{ machine: string | null, id: string } | null>(null)
const waitNoted = ref(false)
watch(() => route.query.task, (id) => {
  if (typeof id !== 'string' || !id) return
  opening.value = { machine: typeof route.query.machine === 'string' ? route.query.machine : null, id }
  waitNoted.value = false
  router.replace({ query: {} })
}, { immediate: true })
watch([opening, board, reads], () => {
  const want = opening.value
  if (!want || !board.value || !reads.value) return
  const hits = allCards.value.filter(x => x.task.id === want.id && (want.machine === null || x.machine === want.machine))
  const fresh = (machine: string) => board.value!.machines.some(m => m.machine === machine && m.status === 'ready' && !m.error && !m.stale)
  if (hits.length === 1) {
    opening.value = null
    openCard(hits[0]!)
    return
  }
  if (want.machine !== null && !fresh(want.machine)) {
    // Its machine does not answer now: said once, tried again at each read.
    if (!waitNoted.value) toast(tl(`${machineLabel(want.machine)} cannot be read now: its task opens once it answers`, `${machineLabel(want.machine)} ne peut pas être lue pour l’instant : sa tâche s’ouvre dès qu’elle répond`), true)
    waitNoted.value = true
    return
  }
  opening.value = null
  toast(tl('That task is no longer on the Board', 'Cette tâche n’est plus sur le Board'), true)
})

// ------------------------------------------------------------ new task
const newOpen = ref(false)
const newFor = ref<{ machine?: string, repo?: string }>({})
function newTask(machine?: string, repo?: string) {
  newFor.value = { machine: machine ?? (shownScope.value !== ALL ? shownScope.value : panel.value?.machine), repo }
  newOpen.value = true
}
function added() { setTimeout(reload, 1500) }

// ------------------------------------------------------------ the panel
// Who the side panel talks to (BoardPanel): a task's agent or a coordinator.
const panel = shallowRef<PanelTarget | null>(null)
function talkTo(machine: string, to: CoordinatorTarget) {
  if (readOnly(machine)) return
  panel.value = { machine, kind: 'coordinator', to }
  haptic()
}
const talking = (machine: string, to: CoordinatorTarget) => {
  const p = panel.value
  if (!p || p.kind !== 'coordinator' || p.machine !== machine || p.to.kind !== to.kind) return false
  return to.kind !== 'project' || (p.to.kind === 'project' && p.to.repo === to.repo)
}
const panelTask = computed(() => {
  const p = panel.value
  return p?.kind === 'task' ? allCards.value.find(c => c.machine === p.machine && c.task.id === p.id)?.task || picked.value?.task || null : null
})
// Its machine left Herdr's list: the panel closes. One that does not answer
// keeps it, with what is being written: nothing goes elsewhere on its own.
watch(board, (b) => {
  if (panel.value && b && !b.machines.some(m => m.machine === panel.value!.machine)) panel.value = null
})
// The panel's task, from its "Task" button or once its agent is gone.
function panelSheet() {
  const p = panel.value
  if (p?.kind !== 'task') return
  const c = allCards.value.find(x => x.machine === p.machine && x.task.id === p.id) || picked.value
  if (!c) return
  // No agent to show: the sheet replaces the panel.
  openSheet(c)
}
function panelNoAgent() {
  panelSheet()
  panel.value = null
}

function back() {
  const from = (history.state as { back?: unknown } | null)?.back
  if (typeof from === 'string' && from.startsWith('/') && from !== '/board') router.back()
  else navigateTo('/', { replace: true })
}
</script>

<template>
  <section id="board" ref="root" class="view board-view" :class="{ 'with-panel': panel && desk, narrow: !wide }">
    <header class="top bar board-top">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn" :aria-label="t('Back')" @click="back" />
      <h2>{{ t('Board') }}</h2>
      <UButton
        v-if="writable.length" icon="i-lucide-plus" color="primary" variant="outline" size="md" class="board-new" :disabled="offlineView"
        :aria-label="tl('New task', 'Nouvelle tâche')" @click="newTask()"
      >
        <span class="board-new-label">{{ tl('New task', 'Nouvelle tâche') }}</span>
      </UButton>
      <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="lg" class="icon-btn board-filter" :aria-label="tl('Refresh', 'Actualiser')" :disabled="offlineView" @click="reload" />
    </header>
    <div v-if="error" class="notice board-notice">{{ error }}</div>
    <p v-else-if="!board && !offlineView" class="board-empty board-loading">{{ t('Loading…') }}</p>

    <div v-if="notes.length || disabled.length || troubles.length || ready.some(m => m.readOnly)" class="board-notes">
      <p v-for="m in troubles" :key="`e-${m.machine}`" class="board-note error" role="alert">
        <b>{{ several ? machineLabel(m.machine) : tl('herdr-projects', 'herdr-projects') }}</b> · {{ m.error || tl('No answer yet', 'Pas encore de réponse') }}<template v-if="m.stale && m.at"> · {{ tl(`tasks as read at ${readAt(m.at)}`, `tâches lues à ${readAt(m.at)}`) }}</template>
      </p>
      <p v-for="m in ready.filter(x => x.readOnly)" :key="`r-${m.machine}`" class="board-note">
        {{ tl('wherdr runs in a container: the Board reads herdr-projects’ files and runs nothing here (its upkeep belongs to the host). Reply, approve, start, stop and the Coordinator: from Herdr on the host, or with herdr-projects there.', 'wherdr tourne dans un conteneur : le Board lit les fichiers de herdr-projects et n’y lance rien (son entretien revient à l’hôte). Répondre, approuver, lancer, arrêter et le Coordinateur : depuis Herdr sur l’hôte, ou avec herdr-projects là-bas.') }}
      </p>
      <ProjectsUpgradeNote
        v-for="m in notes" :key="m.machine" :status="m.status as 'missing' | 'old'" :version="m.version || null"
        :machine="several ? (machineName(m.machine) || hostLabel || t('This machine')) : undefined"
      />
      <p v-for="m in disabled" :key="m.machine" class="board-note">{{ tl(`herdr-projects is disabled in Herdr${several ? ` on ${machineName(m.machine)}` : ''}: herdr plugin enable herdr-projects`, `herdr-projects est désactivé dans Herdr${several ? ` sur ${machineName(m.machine)}` : ''} : herdr plugin enable herdr-projects`) }}</p>
    </div>

    <template v-if="ready.length || cards.length">
      <div class="board-tools">
        <USelect
          v-if="boards.length > 1" :model-value="shownScope" :items="scopeItems" size="sm" class="board-scope" :aria-label="tl('Machines shown', 'Machines affichées')"
          @update:model-value="pickScope(String($event))"
        />
        <div class="board-grouping" role="group" :aria-label="tl('Group tasks', 'Grouper les tâches')">
          <button type="button" :class="{ on: grouping === 'repo' }" :aria-pressed="grouping === 'repo'" @click="pickGrouping('repo')">{{ tl('By repo', 'Par dépôt') }}</button>
          <button type="button" :class="{ on: grouping === 'status' }" :aria-pressed="grouping === 'status'" @click="pickGrouping('status')">{{ tl('By status', 'Par état') }}</button>
        </div>
      </div>

      <!-- Grouped by machine, then by repo. -->
      <div v-if="grouping === 'repo'" class="board-list">
        <section v-for="mg in machineGroups" :key="mg.machine || 'local'" class="board-machine" :data-machine="mg.machine || 'local'">
          <div class="board-head machine" :class="{ talking: talking(mg.machine, { kind: 'main' }) }">
            <button type="button" class="board-fold" :aria-expanded="!folds.has(`m:${mg.machine}`)" :aria-label="tl('Fold', 'Replier')" @click="fold(`m:${mg.machine}`)">
              <UIcon :name="folds.has(`m:${mg.machine}`) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" />
            </button>
            <button
              type="button" class="board-head-talk" :disabled="mg.readOnly || offlineView"
              :aria-label="tl(`Talk to the Coordinator of ${machineLabel(mg.machine)}`, `Parler au Coordinateur de ${machineLabel(mg.machine)}`)"
              @click="talkTo(mg.machine, { kind: 'main' })"
            >
              <b>{{ machineLabel(mg.machine) }}</b>
              <span class="board-head-sum">{{ mg.summary }}</span>
              <UIcon v-if="!mg.readOnly" name="i-lucide-message-square-text" class="board-head-icon" />
            </button>
          </div>
          <template v-if="!folds.has(`m:${mg.machine}`)">
            <section v-for="rg in mg.repos" :key="rg.repo" class="board-repo" :data-repo="rg.repo">
              <div class="board-head repo" :class="{ talking: talking(mg.machine, { kind: 'project', repo: rg.repo }) }">
                <button type="button" class="board-fold" :aria-expanded="!folds.has(`r:${mg.machine}|${rg.repo}`)" :aria-label="tl('Fold', 'Replier')" @click="fold(`r:${mg.machine}|${rg.repo}`)">
                  <UIcon :name="folds.has(`r:${mg.machine}|${rg.repo}`) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" />
                </button>
                <button
                  type="button" class="board-head-talk" :disabled="mg.readOnly || offlineView"
                  :aria-label="tl(`Talk to the ${rg.repo} coordinator`, `Parler au coordinateur ${rg.repo}`)"
                  @click="talkTo(mg.machine, { kind: 'project', repo: rg.repo })"
                >
                  <b>{{ rg.repo }}</b>
                  <span class="board-head-sum">{{ rg.summary }}</span>
                  <UIcon v-if="!mg.readOnly" name="i-lucide-message-square-text" class="board-head-icon" />
                </button>
                <UButton
                  v-if="!mg.readOnly" icon="i-lucide-plus" color="neutral" variant="ghost" size="sm" class="board-head-add" :disabled="offlineView"
                  :aria-label="tl(`New task in ${rg.repo}`, `Nouvelle tâche dans ${rg.repo}`)" @click="newTask(mg.machine, rg.repo)"
                />
              </div>
              <!-- Its five groups: columns on a computer (an empty one stays narrow), stacked
                   sections that fold on a phone (an empty one is left out: the heading counts). -->
              <div v-if="!folds.has(`r:${mg.machine}|${rg.repo}`)" class="board-repo-cols" :class="{ desk: wide }" :style="wide ? { '--repo-cols': rg.tracks } : undefined">
                <section
                  v-for="col in rg.cols" v-show="wide || col.total" :key="col.id" class="board-repo-col" :class="[col.id, { empty: !col.total }]"
                  :data-group="col.id" :aria-label="col.label"
                >
                  <h4 v-if="wide" class="board-repo-col-head"><span>{{ col.label }}</span><span class="pp-count">{{ col.total }}</span></h4>
                  <button
                    v-else type="button" class="board-repo-col-head" :aria-expanded="!folds.has(`g:${mg.machine}|${rg.repo}|${col.id}`)"
                    @click="fold(`g:${mg.machine}|${rg.repo}|${col.id}`)"
                  >
                    <UIcon :name="folds.has(`g:${mg.machine}|${rg.repo}|${col.id}`) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" />
                    <span>{{ col.label }}</span><span class="pp-count">{{ col.total }}</span>
                  </button>
                  <div v-if="wide ? col.total : !folds.has(`g:${mg.machine}|${rg.repo}|${col.id}`)" class="board-repo-col-body">
                    <TaskCard v-for="c in col.cards" :key="c.key" :task="c.task" :stale="c.stale" :read-at="readAt(c.readAt)" @open="openCard(c)" />
                    <button v-if="col.hidden" type="button" class="board-more" @click="showAll = true">
                      {{ tl(`Show all (${col.hidden} more)`, `Tout afficher (${col.hidden} de plus)`) }}
                    </button>
                  </div>
                </section>
              </div>
            </section>
            <p v-if="!mg.repos.length" class="board-empty board-machine-empty">{{ tl('No task yet: talk to the Coordinator from this machine’s heading, or add one.', 'Aucune tâche : parle au Coordinateur depuis l’en-tête de cette machine, ou ajoutes-en une.') }}</p>
          </template>
        </section>
      </div>

      <!-- The five groups of herdr-projects' board. -->
      <template v-else>
        <div v-if="!wide" class="board-seg tasks" role="group" :aria-label="t('Board')">
          <button
            v-for="col in columns" :key="col.id" type="button" class="board-seg-btn" :class="[col.id, { on: phoneColumn === col.id }]"
            :aria-pressed="phoneColumn === col.id" @click="selectColumn(col.id)"
          >
            <span>{{ col.label }}</span><b>{{ col.total }}</b>
          </button>
        </div>
        <div class="board-cols">
          <section v-for="col in columns" v-show="wide || phoneColumn === col.id" :key="col.id" class="board-col" :class="col.id" :aria-label="col.label">
            <h3 v-if="wide" class="board-col-head"><span>{{ col.label }}</span><span class="pp-count">{{ col.total }}</span></h3>
            <div class="board-col-body">
              <TaskCard
                v-for="c in col.cards" :key="c.key" :task="c.task" :machine="several && shownScope === ALL ? machineName(c.machine) : undefined"
                :stale="c.stale" :read-at="readAt(c.readAt)" @open="openCard(c)"
              />
              <p v-if="!col.cards.length" class="board-empty">{{ t('Nothing here') }}</p>
              <button v-if="col.hidden" type="button" class="board-more" @click="showAll = true">
                {{ tl(`Show all (${col.hidden} more)`, `Tout afficher (${col.hidden} de plus)`) }}
              </button>
            </div>
          </section>
        </div>
      </template>
    </template>
    <BoardPanel
      v-if="panel" :key="panel.kind === 'task' ? `t|${panel.machine}|${panel.id}` : `c|${panel.machine}`" :target="panel" :task="panelTask"
      :machine-label="machineLabel(panel.machine)" :read-only="readOnly(panel.machine)" :reachable="writable.some(m => m.machine === panel!.machine)"
      @close="panel = null" @sheet="panelSheet" @no-agent="panelNoAgent"
    />
    <TaskSheet v-model:open="sheetOpen" :task="pickedTask" :machine="picked?.machine ?? ''" :read-only="readOnly(picked?.machine ?? '')" :in-panel="Boolean(panel)" @changed="reload" />
    <NewTaskSheet v-model:open="newOpen" :machines="writable.map(m => m.machine)" :repos="reposByMachine" :machine="newFor.machine" :repo="newFor.repo" @added="added" />
  </section>
</template>
