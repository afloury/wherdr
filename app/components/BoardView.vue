<script setup lang="ts">
// The Board: herdr-projects 1.x tasks of every machine, in the groups of its
// board (Needs you, Ready to approve, Working, To do, Done), as columns of
// equal width. Done is history: hidden until its toggle in the column heads
// ("Done · 9") shows it (boardDone.ts). Two views of the same grid: "Global" mixes every
// machine's and repo's tasks; "By repo" cuts it into lanes, one per machine then
// per repo (1.x: `Alt+M` with `Alt+S`), aligned from one column to the next.
// On a phone (or a Board narrowed by the side panel): one group at a time, in
// tabs, with the lanes inside.
//
// Talking to agents happens in a side panel (BoardPanel), never in a box on the
// Board: a card opens its task's agent there; labelled buttons open a
// coordinator: the Coordinator (top bar), the machine
// coordinator (each machine's lane) and a repo's project coordinator (its lane;
// 1.x: `Space` on a heading). Every task opens the panel, including tasks
// without an agent. Its Task tab and optional sheet keep details and actions
// available. "+ New task" adds one (NewTaskSheet).
// A task archived from its sheet leaves the Board at once, with a toast that
// offers Restore for a few seconds; "Archived" lists the archived tasks, each
// one's sheet read-only with Restore (as in 1.x).
// A machine without herdr-projects 1.2.1+ says what to do instead
// (ProjectsUpgradeNote).
//
// What is kept on this device only: the machine shown, the grouping, folded
// headings, Done shown or not. Nothing about the projects themselves: that is herdr-projects'.
import {
  type CoordinatorTarget, TASK_GROUPS, type TaskGroup, type TaskRow, groupCounts, sortTasks, taskKey,
} from '#shared/projectsTasks'
import type { SelectItem } from '@nuxt/ui'
import type { PanelTarget } from './BoardPanel.vue'
// The home list's machine groups (Settings › Machine bar); `machineGroups` here is the Board's lanes.
import { machineGroups as barGroups } from '~/composables/useMachineBar'

const COLUMN_KEY = 'boardColumn'
const SCOPE_KEY = 'boardMachine'
const GROUPING_KEY = 'boardGrouping'
const FOLDS_KEY = 'boardFolds'

const router = useRouter()
const route = useRoute()
const { board, error, reads, reload } = useTasksBoard()
const projectLinks = useBoardLinks()

const readStore = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const writeStore = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } }

const ready = computed(() => (board.value?.machines || []).filter(m => m.status === 'ready'))
// Machines whose last read failed, or whose tasks are an older read: said, with when.
const troubles = computed(() => (board.value?.machines || []).filter(m => m.error || m.stale))
const machineLabel = (key: string) => boardMachineLabel(key, machineName(key), hostLabel.value || t('This machine'))
const readAt = (at?: number) => (at ? new Date(at).toLocaleTimeString(language === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '')
// Machines Herdr answers on but where the Board cannot read herdr-projects.
const notes = computed(() => (board.value?.machines || []).filter(m => m.status === 'missing' || m.status === 'old'))
const disabled = computed(() => (board.value?.machines || []).filter(m => m.status === 'disabled'))
const several = computed(() => (board.value?.machines.length || 0) > 1)

// ------------------------------------------------------------ what is shown
// The machines with a board (or tasks from an earlier read), in Herdr's order.
const boards = computed(() => (board.value?.machines || []).filter(m => m.status === 'ready' || m.tasks.length))
// The machine's key (the local one is ''), a machine group's ID (the home
// list's groups, edited in Settings), or SCOPE_ALL.
const scope = ref(boardScopeMachine(readStore(SCOPE_KEY)))
// A machine that went away, or a group deleted: every machine again. A group
// edited in Settings: its machines now.
const shownScope = computed<string>(() => boardShownScope(scope.value, boards.value.map(m => m.machine), barGroups.value))
// The machines shown (null: every machine).
const scopeMachines = computed<string[] | null>(() => boardScopeMachines(shownScope.value, barGroups.value))
const inScope = (machine: string): boolean => scopeMachines.value === null || scopeMachines.value.includes(machine)
// The machine named on each card: when the cards can come from several machines.
const namesOnCards = computed(() => several.value && (scopeMachines.value === null || scopeMachines.value.length > 1))
// The local machine is in it too, under its own value.
const scopeItems = computed<SelectItem[]>(() => boardScopeItems(boards.value.map(m => m.machine), machineLabel, tl('All machines', 'Toutes les machines'),
  barGroups.value, tl('Groups', 'Groupes'), tl('Machines', 'Machines')))
function pickScope(v: string) {
  scope.value = boardScopeMachine(v)
  writeStore(SCOPE_KEY, v)
}
const shownBoards = computed(() => boards.value.filter(m => inScope(m.machine)))

// `global` was stored as `status` before it was renamed.
type Grouping = 'repo' | 'global'
const grouping = ref<Grouping>(['global', 'status'].includes(readStore(GROUPING_KEY) || '') ? 'global' : 'repo')
function pickGrouping(g: Grouping) {
  grouping.value = g
  writeStore(GROUPING_KEY, g)
}

interface Card { key: string, machine: string, task: TaskRow, stale: boolean, readAt?: number }
const cardOf = (m: { machine: string, stale?: boolean, at?: number }, task: TaskRow): Card =>
  ({ key: `${m.machine}|${task.id}`, machine: m.machine, task, stale: Boolean(m.stale || task.stale), readAt: task.stale ? task.readAt : m.at })
// Tasks archived from here (`<machine>|<id>`): off the Board at once, before a
// read of the Board leaves them out; forgotten once a read does.
const archivedHere = shallowRef(new Set<string>())
const setArchivedHere = (key: string, on: boolean) => {
  const next = new Set(archivedHere.value)
  if (on) next.add(key)
  else next.delete(key)
  archivedHere.value = next
}
watch(board, (b) => {
  if (!b || !archivedHere.value.size) return
  const listed = new Set(b.machines.flatMap(m => m.tasks.filter(t => !t.archived).map(t => `${m.machine}|${t.id}`)))
  const kept = [...archivedHere.value].filter(k => listed.has(k))
  if (kept.length !== archivedHere.value.size) archivedHere.value = new Set(kept)
})
// A machine Herdr did not answer for keeps its last tasks, marked as older.
const allCards = computed<Card[]>(() => boards.value.flatMap(m => sortTasks(m.tasks.filter(t => !t.archived && !archivedHere.value.has(`${m.machine}|${t.id}`))).map(task => cardOf(m, task))))
const cards = computed(() => allCards.value.filter(c => inScope(c.machine)))
// Done: hidden until asked for, on this device; shown, its latest few until "N more".
const showDone = ref(boardDoneShown(readStore(BOARD_DONE_KEY)))
const showAll = ref(false)
const doneCount = computed(() => cards.value.filter(c => c.task.group === 'done').length)
function toggleDone() {
  showDone.value = !showDone.value
  writeStore(BOARD_DONE_KEY, boardDoneStored(showDone.value))
  if (!showDone.value) showAll.value = false
  // Phone: what was asked for comes into view.
  else if (!wide.value) selectColumn('done')
  haptic()
}
const doneToggleLabel = computed(() => (showDone.value
  ? tl('Hide done tasks', 'Masquer les tâches faites')
  : tl(`Show done tasks (${doneCount.value})`, `Afficher les tâches faites (${doneCount.value})`)))
const groups = computed(() => boardGroups(showDone.value))
const columns = computed(() => groups.value.map((id) => {
  const inGroup = cards.value.filter(c => c.task.group === id)
  // Done: the latest few of every machine shown, not of the first one.
  const all = id === 'done' ? doneNewestFirst(inGroup) : inGroup
  return { id, label: taskGroupLabel(id), total: all.length, ...boardCell(id, all, showAll.value, DONE_LATEST) }
}))
// As many columns as groups shown, of equal width.
const gridStyle = computed(() => ({ '--board-cols': `repeat(${columns.value.length}, minmax(0, 1fr))` }))

// Folded headings (`m:<machine>`, `r:<machine>|<repo>`), on this device.
const folds = ref(new Set<string>((() => { try { return JSON.parse(readStore(FOLDS_KEY) || '[]') as string[] } catch { return [] } })()))
function fold(key: string) {
  const next = new Set(folds.value)
  if (!next.delete(key)) next.add(key)
  folds.value = next
  writeStore(FOLDS_KEY, JSON.stringify([...next].slice(-200)))
}

// What a heading holds, in a few words: what needs you first; done last, and quietly.
function summary(rows: TaskRow[]): { main: string, done: string } {
  const c = groupCounts(rows)
  const parts = (['needs', 'ready', 'working', 'todo'] as const).filter(g => c[g]).map(g => `${c[g]} ${taskGroupLabel(g).toLowerCase()}`)
  const done = c.done ? tl(`${c.done} done`, `${c.done} fait${c.done > 1 ? 's' : ''}`) : ''
  return { main: parts.join(' · ') || (done ? '' : tl('no task', 'aucune tâche')), done }
}
const machineGroups = computed(() => shownBoards.value.map((m) => {
  const rows = m.tasks.filter(t => !t.archived && !archivedHere.value.has(`${m.machine}|${t.id}`))
  return {
    machine: m.machine,
    summary: summary(rows),
    repos: [...new Set([...rows.map(t => t.repo), ...(projectLinks.value.find(b => b.machine === m.machine)?.repos || []).map(r => r.repo)])].sort().map(repo => {
      const tasks = sortTasks(rows.filter(t => t.repo === repo))
      // The board's groups in each repo's lane, under the Board's columns.
      const cols = groups.value.map((id) => {
        const all = tasks.filter(t => t.group === id).map(task => cardOf(m, task))
        return { id, label: taskGroupLabel(id), total: all.length, ...boardCell(id, all, showAll.value, DONE_LATEST_REPO) }
      })
      return { repo, summary: summary(tasks), cols }
    }),
  }
}))
// Each machine's repos, as its tasks show them: the choices of "+ New task".
const reposByMachine = computed(() => Object.fromEntries(boards.value.map(m => [m.machine, [...new Set(m.tasks.map(t => t.repo))].sort()])))

// Columns side by side need room: on a phone, or a Board narrowed by the side
// panel, one group at a time (tabs), in both views.
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
// Done hidden: its tab is gone, the first one shows.
const shownColumn = computed(() => boardPhoneColumn(phoneColumn.value, showDone.value))
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
// A card always opens the task panel. No agent yet: the panel explains
// setup failures and keeps the task's details and actions reachable.
function openCard(c: Card) {
  picked.value = c
  panel.value = { machine: c.machine, kind: 'task', id: c.task.id }
  haptic()
}
// The open task as the last read has it (its group or review may have moved on).
const pickedTask = computed(() => {
  const p = picked.value
  if (!p) return null
  return allCards.value.find(c => c.key === p.key)?.task
    || archivedCards.value.find(c => c.key === p.key)?.task
    || (archivedHere.value.has(p.key) ? { ...p.task, archived: true } : p.task)
})
// A push about a task opens it: `#/board?machine=<key>&task=<repo>/<n>`. The
// same id can be on two machines: only that machine's task opens (a link with
// no machine: the one card with that id). The kept board may predate the task,
// so nothing is concluded before a read of this visit; a machine that cannot be
// read keeps the request until it answers.
const opening = ref<{ machine: string | null, id: string } | null>(null)
const waitNoted = ref(false)
// `#/board?machine=<key>` alone (a machine's menu on the home list): the Board
// filtered on that machine, as if picked here. The local machine is `machine=`.
watch(() => route.query, (q) => {
  if (q.coordinator || ('task' in q && q.task) || !('machine' in q)) return
  const m = q.machine
  if (typeof m === 'string' || m === null) pickScope(boardScopeValue(m ?? ''))
  router.replace({ query: {} })
}, { immediate: true })
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
  // Not on the Board: maybe archived, whose sheet opens read-only with Restore.
  openArchived(want)
})
async function openArchived(want: { machine: string | null, id: string }) {
  const where = boards.value.filter(m => m.status === 'ready' && (want.machine === null || m.machine === want.machine)).map(m => m.machine)
  const found = (await Promise.all(where.map(m => api<{ machine: string, tasks: TaskRow[] }>(`/api/tasks/archived?machine=${encodeURIComponent(m)}`).catch(() => null))))
    .flatMap(r => (r ? r.tasks.filter(t => t.id === want.id).map(t => cardOf({ machine: r.machine }, t)) : []))
  if (found.length === 1) return openSheet(found[0]!)
  toast(tl('That task is no longer on the Board', 'Cette tâche n’est plus sur le Board'), true)
}

// ------------------------------------------------------------ archived
// "Archived": each machine's archived tasks, read when it is opened (and again
// after an archive or a restore from here), newest first.
const showArchived = ref(false)
const archivedBoards = shallowRef<{ machine: string, tasks: TaskRow[], error?: string }[]>([])
const archivedLoading = ref(false)
let archivedSeq = 0
async function loadArchived() {
  if (!showArchived.value) return
  const id = ++archivedSeq
  archivedLoading.value = true
  const where = boards.value.filter(m => m.status === 'ready').map(m => m.machine)
  const got = await Promise.all(where.map(machine => api<{ machine: string, tasks: TaskRow[] }>(`/api/tasks/archived?machine=${encodeURIComponent(machine)}`)
    .then(r => ({ machine, tasks: r.tasks }))
    .catch((e: Error) => ({ machine, tasks: [] as TaskRow[], error: e.message }))))
  if (id !== archivedSeq) return
  archivedBoards.value = got
  archivedLoading.value = false
}
function toggleArchived() {
  showArchived.value = !showArchived.value
  if (showArchived.value) loadArchived()
}
const archivedCards = computed<Card[]>(() => archivedBoards.value
  .filter(m => inScope(m.machine))
  .flatMap(m => m.tasks.map(t => cardOf({ machine: m.machine }, t))))
const archivedErrors = computed(() => archivedBoards.value.filter(m => m.error && inScope(m.machine)))

// Archived from its sheet: off the Board now, its agent's panel closed (the
// agent ends with its space), and a few seconds to take it back.
function onArchived(machine: string, task: TaskRow) {
  setArchivedHere(`${machine}|${task.id}`, true)
  const p = panel.value
  if (p?.kind === 'task' && p.machine === machine && p.id === task.id) panel.value = null
  const name = taskKey(task.id, task.repoKey)
  toast(tl(`${name} archived`, `${name} archivée`), false, undefined, {
    label: tl('Restore', 'Restaurer'), icon: 'i-lucide-archive-restore', run: () => restoreTask(machine, task),
  })
  reload().then(loadArchived)
}
async function restoreTask(machine: string, task: TaskRow) {
  try {
    await api('/api/tasks/action', { machine, id: task.id, action: 'restore' })
    haptic()
    toast(tl(`${taskKey(task.id, task.repoKey)} restored`, `${taskKey(task.id, task.repoKey)} restaurée`))
    onRestored(machine, task)
  } catch (e) { toast((e as Error).message, true) }
}
function onRestored(machine: string, task: TaskRow) {
  setArchivedHere(`${machine}|${task.id}`, false)
  archivedBoards.value = archivedBoards.value.map(m => (m.machine === machine ? { ...m, tasks: m.tasks.filter(t => t.id !== task.id) } : m))
  reload().then(loadArchived)
}

// ------------------------------------------------------------ new task
const newOpen = ref(false)
const newFor = ref<{ machine?: string, repo?: string }>({})
function newTask(machine?: string, repo?: string) {
  newFor.value = { machine: machine ?? (scopeMachines.value?.length === 1 ? scopeMachines.value[0] : panel.value?.machine), repo }
  newOpen.value = true
}
function added() { setTimeout(reload, 1500) }

// ------------------------------------------------------------ the panel
// Who the side panel talks to (BoardPanel): a task's agent or a coordinator.
const panel = shallowRef<PanelTarget | null>(null)
function talkTo(machine: string, to: CoordinatorTarget) {
  if (coordWhy(machine)) return
  panel.value = { machine, kind: 'coordinator', to }
  haptic()
}
// New opens the same panel, including an unregistered repository path.
watch(() => route.query.coordinator, (repo) => {
  if (typeof repo !== 'string' || !repo) return
  panel.value = { machine: typeof route.query.machine === 'string' ? route.query.machine : '', kind: 'coordinator', to: { kind: 'project', repo }, freshProject: true }
  router.replace({ query: {} })
}, { immediate: true })
const coordLabel = (machine: string, to: CoordinatorTarget) => coordinatorLabel(to, machineLabel(machine))
const MACHINE_COORDS: CoordinatorTarget[] = [{ kind: 'machine' }]
// The main Coordinator is an entry point for all work, independent of task filters.
const coordMachines = computed(() => board.value?.machines || [])
const coordWhy = (machine: string) => {
  const m = coordMachines.value.find(m => m.machine === machine)
  return m ? coordinatorUnavailable(m, offlineView.value) : tl('Machine unavailable', 'Machine indisponible')
}
const coordHint = (machine: string, to: CoordinatorTarget) => [coordinatorDescription(to), coordWhy(machine)].filter(Boolean).join(' ')
const coordItems = computed(() => [coordMachines.value.map(m => ({
  label: coordLabel(m.machine, { kind: 'main' }),
  description: coordHint(m.machine, { kind: 'main' }),
  disabled: Boolean(coordWhy(m.machine)),
  icon: 'i-lucide-server',
  onSelect: () => talkTo(m.machine, { kind: 'main' }),
}))])
const noCoordinator = computed(() => Boolean(board.value) && !coordMachines.value.some(m => !coordWhy(m.machine)))
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
// The project's coordinator on the task's own machine.
function askCoordinator(machine: string, task: TaskRow) {
  talkTo(machine, { kind: 'project', repo: task.repo })
}
// The task agent conversation, separate from its project coordinator.
function chatWith(machine: string, task: TaskRow) {
  panel.value = { machine, kind: 'task', id: task.id, chat: true }
  haptic()
}
// The panel's task, from its "Task" button or once its agent is gone.
function panelSheet() {
  const p = panel.value
  if (p?.kind !== 'task') return
  const c = allCards.value.find(x => x.machine === p.machine && x.task.id === p.id) || picked.value
  if (!c) return
  // No agent to show: the sheet replaces the panel.
  openSheet(c)
}
// One panel per target: nothing of one coordinator or task (a reply on its
// way, a message being written) carries over to another.
const panelKey = computed(() => {
  const p = panel.value
  if (!p) return ''
  return p.kind === 'task' ? `t|${p.machine}|${p.id}` : `c|${p.machine}|${p.to.kind}|${p.to.kind === 'project' ? p.to.repo : ''}`
})
// Its agent is gone: its sheet, while the task is on the Board (an archived
// one, whose space herdr-projects just closed, is not opened again).
function panelNoAgent() {
  const p = panel.value
  if (p?.kind === 'task' && allCards.value.some(c => c.machine === p.machine && c.task.id === p.id)) panelSheet()
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
        v-if="ready.length" icon="i-lucide-plus" color="primary" variant="outline" size="md" class="board-new" :disabled="offlineView"
        :aria-label="tl('New task', 'Nouvelle tâche')" @click="newTask()"
      >
        <span class="board-new-label">{{ tl('New task', 'Nouvelle tâche') }}</span>
      </UButton>
      <CoordinatorHint v-if="coordMachines.length === 1" :text="coordHint(coordMachines[0]!.machine, { kind: 'main' })">
        <UButton color="neutral" variant="outline" size="md" class="board-coord board-top-coord"
          :class="{ on: talking(coordMachines[0]!.machine, { kind: 'main' }) }" :disabled="Boolean(coordWhy(coordMachines[0]!.machine))"
          @click="talkTo(coordMachines[0]!.machine, { kind: 'main' })"
        >{{ coordLabel(coordMachines[0]!.machine, { kind: 'main' }) }}</UButton>
      </CoordinatorHint>
      <UDropdownMenu v-else-if="coordMachines.length > 1" :items="coordItems" :content="{ align: 'end', sideOffset: 6 }" :ui="{ content: 'hw-dropdown board-coord-menu', itemLabel: 'whitespace-normal', itemDescription: 'whitespace-normal' }">
        <CoordinatorHint :text="coordinatorDescription({ kind: 'main' })">
          <UButton color="neutral" variant="outline" size="md" class="board-coord board-top-coord" trailing-icon="i-lucide-chevron-down">
            {{ tl('Coordinator · all work', 'Coordinateur · tout le travail') }}
          </UButton>
        </CoordinatorHint>
      </UDropdownMenu>
      <UButton icon="i-lucide-refresh-cw" color="neutral" variant="ghost" size="lg" class="icon-btn board-filter" :aria-label="tl('Refresh', 'Actualiser')" :disabled="offlineView" @click="reload" />
    </header>
    <div v-if="error" class="notice board-notice">{{ error }}</div>
    <p v-else-if="!board && !offlineView" class="board-empty board-loading">{{ t('Loading…') }}</p>

    <div v-if="noCoordinator || notes.length || disabled.length || troubles.length" class="board-notes">
      <p v-if="noCoordinator" class="board-note" role="status">{{ tl('No Coordinator can be reached now. See each machine’s availability.', 'Aucun Coordinateur n’est joignable pour l’instant. Consulte la disponibilité de chaque machine.') }}</p>
      <p v-for="m in troubles" :key="`e-${m.machine}`" class="board-note error" role="alert">
        <b>{{ several ? machineLabel(m.machine) : tl('herdr-projects', 'herdr-projects') }}</b> · {{ m.error || tl('No answer yet', 'Pas encore de réponse') }}<template v-if="m.stale && m.at"> · {{ tl(`tasks as read at ${readAt(m.at)}`, `tâches lues à ${readAt(m.at)}`) }}</template>
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
          v-if="boards.length > 1" :model-value="boardScopeValue(shownScope)" :items="scopeItems" size="sm" class="board-scope" :aria-label="tl('Machines shown', 'Machines affichées')"
          @update:model-value="pickScope(String($event))"
        />
        <div class="board-grouping" role="group" :aria-label="tl('View', 'Vue')">
          <button type="button" :class="{ on: grouping === 'global' }" :aria-pressed="grouping === 'global'" @click="pickGrouping('global')">{{ tl('Global', 'Global') }}</button>
          <button type="button" :class="{ on: grouping === 'repo' }" :aria-pressed="grouping === 'repo'" @click="pickGrouping('repo')">{{ tl('By repo', 'Par dépôt') }}</button>
        </div>
        <div class="board-grouping board-archived-toggle">
          <button type="button" :class="{ on: showArchived }" :aria-pressed="showArchived" :disabled="offlineView" @click="toggleArchived">
            <UIcon name="i-lucide-archive" />{{ tl('Archived', 'Archivées') }}
          </button>
        </div>
      </div>

      <!-- Phone, or a Board narrowed by the panel: one group at a time, in both views. -->
      <div v-if="!wide" class="board-seg tasks" :style="{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr)) auto` }" role="group" :aria-label="t('Board')">
        <button
          v-for="col in columns" :key="col.id" type="button" class="board-seg-btn" :class="[col.id, { on: shownColumn === col.id }]"
          :aria-pressed="shownColumn === col.id" @click="selectColumn(col.id)"
        >
          <span>{{ col.label }}</span><b>{{ col.total }}</b>
        </button>
        <!-- Done, hidden: its toggle shows it (as a tab); shown: the same place hides it. -->
        <button
          type="button" class="board-seg-btn board-done-toggle" :class="{ shown: showDone }" :aria-pressed="showDone"
          :aria-label="doneToggleLabel" :title="doneToggleLabel" @click="toggleDone"
        >
          <template v-if="showDone"><UIcon name="i-lucide-eye-off" class="board-done-icon" /></template>
          <template v-else><span>{{ taskGroupLabel('done') }}</span><b><UIcon name="i-lucide-eye" class="board-done-icon" />{{ doneCount }}</b></template>
        </button>
      </div>

      <!-- The same grid in both views: columns of equal width. "By repo" cuts it into lanes. -->
      <div class="board-grid" :class="{ desk: wide, lanes: grouping === 'repo' }" :style="gridStyle">
        <div v-if="wide" class="board-grid-head">
          <h3 v-for="(col, i) in columns" :key="col.id" class="board-col-head" :class="col.id">
            <span>{{ col.label }}</span><span class="pp-count">{{ col.total }}</span>
            <!-- At the end of the heads: "Done · 9" shows Done, "Hide" on its head hides it. -->
            <button
              v-if="i === columns.length - 1" type="button" class="board-done-toggle" :class="{ shown: showDone }" :aria-pressed="showDone"
              :aria-label="doneToggleLabel" :title="doneToggleLabel" @click="toggleDone"
            >
              <UIcon :name="showDone ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="board-done-icon" />
              <span>{{ showDone ? tl('Hide', 'Masquer') : `${taskGroupLabel('done')} · ${doneCount}` }}</span>
            </button>
          </h3>
        </div>

        <div v-if="grouping === 'global'" class="board-cols board-cells">
          <section v-for="col in columns" v-show="wide || shownColumn === col.id" :key="col.id" class="board-col" :class="col.id" :aria-label="col.label">
            <div class="board-col-body">
              <TaskCard
                v-for="c in col.cards" :key="c.key" :task="c.task" :machine="namesOnCards ? machineName(c.machine) : undefined"
                :stale="c.stale" :read-at="readAt(c.readAt)" @open="openCard(c)"
              />
              <p v-if="!col.cards.length" class="board-empty">{{ t('Nothing here') }}</p>
              <button v-if="col.hidden" type="button" class="board-more" @click="showAll = true">
                {{ tl(`Show all (${col.hidden} more)`, `Tout afficher (${col.hidden} de plus)`) }}
              </button>
            </div>
          </section>
        </div>

        <template v-else>
          <section v-for="mg in machineGroups" :key="mg.machine || 'local'" class="board-machine" :data-machine="mg.machine || 'local'">
            <div class="board-head machine" :class="{ talking: talking(mg.machine, { kind: 'main' }) || talking(mg.machine, { kind: 'machine' }) }">
              <button type="button" class="board-fold" :aria-expanded="!folds.has(`m:${mg.machine}`)" :aria-label="tl('Fold', 'Replier')" @click="fold(`m:${mg.machine}`)">
                <UIcon :name="folds.has(`m:${mg.machine}`) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" />
              </button>
              <p class="board-head-name"><b>{{ machineLabel(mg.machine) }}</b><span class="board-head-sum">{{ mg.summary.main }}<span v-if="mg.summary.done" class="board-head-done">{{ mg.summary.main ? ' · ' : '' }}{{ mg.summary.done }}</span></span></p>
              <div class="board-head-actions">
                <CoordinatorHint v-for="to in MACHINE_COORDS" :key="to.kind" :text="coordHint(mg.machine, to)">
                  <UButton
                    color="neutral" variant="outline" size="sm" class="board-coord" :class="{ on: talking(mg.machine, to) }"
                    :disabled="Boolean(coordWhy(mg.machine))" :aria-description="coordWhy(mg.machine) || undefined" @click="talkTo(mg.machine, to)"
                  >
                    {{ coordLabel(mg.machine, to) }}
                  </UButton>
                </CoordinatorHint>
              </div>
            </div>
            <template v-if="!folds.has(`m:${mg.machine}`)">
              <section v-for="rg in mg.repos" :key="rg.repo" class="board-repo" :data-repo="rg.repo">
                <div class="board-head repo" :class="{ talking: talking(mg.machine, { kind: 'project', repo: rg.repo }) }">
                  <button type="button" class="board-fold" :aria-expanded="!folds.has(`r:${mg.machine}|${rg.repo}`)" :aria-label="tl('Fold', 'Replier')" @click="fold(`r:${mg.machine}|${rg.repo}`)">
                    <UIcon :name="folds.has(`r:${mg.machine}|${rg.repo}`) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" />
                  </button>
                  <p class="board-head-name"><b>{{ rg.repo }}</b><span class="board-head-sum">{{ rg.summary.main }}<span v-if="rg.summary.done" class="board-head-done">{{ rg.summary.main ? ' · ' : '' }}{{ rg.summary.done }}</span></span></p>
                  <div class="board-head-actions">
                    <CoordinatorHint :text="coordHint(mg.machine, { kind: 'project', repo: rg.repo })">
                      <UButton
                        color="neutral" variant="outline" size="sm" class="board-coord" :class="{ on: talking(mg.machine, { kind: 'project', repo: rg.repo }) }"
                        :disabled="Boolean(coordWhy(mg.machine))" :aria-description="coordWhy(mg.machine) || undefined" @click="talkTo(mg.machine, { kind: 'project', repo: rg.repo })"
                      >
                        {{ coordLabel(mg.machine, { kind: 'project', repo: rg.repo }) }}
                      </UButton>
                    </CoordinatorHint>
                    <UButton
                      icon="i-lucide-plus" color="neutral" variant="outline" size="sm" class="board-head-add" :disabled="offlineView"
                      :aria-label="tl(`New task in ${rg.repo}`, `Nouvelle tâche dans ${rg.repo}`)" @click="newTask(mg.machine, rg.repo)"
                    />
                  </div>
                </div>
                <!-- Its lane: one cell under each of the Board's columns. -->
                <div v-if="!folds.has(`r:${mg.machine}|${rg.repo}`)" class="board-repo-cols board-cells">
                  <section
                    v-for="col in rg.cols" v-show="wide || shownColumn === col.id" :key="col.id" class="board-repo-col" :class="[col.id, { none: !col.total }]"
                    :data-group="col.id" :aria-label="col.label"
                  >
                    <div class="board-repo-col-body">
                      <TaskCard v-for="c in col.cards" :key="c.key" :task="c.task" :stale="c.stale" :read-at="readAt(c.readAt)" @open="openCard(c)" />
                      <p v-if="!wide && !col.total" class="board-empty">{{ t('Nothing here') }}</p>
                      <button v-if="col.hidden" type="button" class="board-more" @click="showAll = true">
                        {{ tl(`Show all (${col.hidden} more)`, `Tout afficher (${col.hidden} de plus)`) }}
                      </button>
                    </div>
                  </section>
                </div>
              </section>
              <p v-if="!mg.repos.length" class="board-empty board-machine-empty">{{ tl('No task yet: talk to the Coordinator at the top, or add one.', 'Aucune tâche : parle au Coordinateur en haut, ou ajoutes-en une.') }}</p>
            </template>
          </section>
        </template>

        <!-- Archived tasks: each opens its sheet, read-only with Restore. -->
        <section v-if="showArchived" class="board-archived" :aria-label="tl('Archived tasks', 'Tâches archivées')">
          <h3 class="board-col-head archived"><span>{{ tl('Archived', 'Archivées') }}</span><span class="pp-count">{{ archivedCards.length }}</span></h3>
          <p v-for="m in archivedErrors" :key="m.machine" class="board-note error">
            <b v-if="several">{{ machineLabel(m.machine) }} · </b>{{ m.error }}
          </p>
          <div class="board-archived-body">
            <TaskCard
              v-for="c in archivedCards" :key="c.key" :task="c.task" :machine="namesOnCards ? machineName(c.machine) : undefined"
              @open="openSheet(c)"
            />
          </div>
          <p v-if="archivedLoading && !archivedCards.length" class="board-empty">{{ t('Loading…') }}</p>
          <p v-else-if="!archivedCards.length" class="board-empty">{{ t('Nothing here') }}</p>
        </section>
      </div>
    </template>
    <BoardPanel
      v-if="panel" :key="panelKey" :target="panel" :task="panelTask"
      :refresh="reload" :machine-label="machineLabel(panel.machine)" :reachable="ready.some(m => m.machine === panel!.machine)"
      @archived="onArchived" @restored="onRestored" @changed="reload" @close="panel = null" @sheet="panelSheet" @no-agent="panelNoAgent" @coordinator="askCoordinator"
    />
    <TaskSheet
      v-model:open="sheetOpen" :task="pickedTask" :machine="picked?.machine ?? ''"
      :refresh="reload" @archived="onArchived" @restored="onRestored" @chat="chatWith" @coordinator="askCoordinator"
    />
    <NewTaskSheet v-model:open="newOpen" :machines="ready.map(m => m.machine)" :repos="reposByMachine" :machine="newFor.machine" :repo="newFor.repo" @added="added" />
  </section>
</template>
