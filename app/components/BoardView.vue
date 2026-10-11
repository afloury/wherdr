<script setup lang="ts">
// Global Board: every project, thread, TASKS.md task and agent in four columns
// (Blocked, Todo, Ongoing, Finished). Computer: columns side by side; phone: one
// column at a time under a segmented control. Task cards move through the project's
// coordinator (menu or drag and drop); the other cards open what they stand for.
import { BOARD_COLUMNS, type BoardCard, type BoardColumn, type BoardMove, type TaskCard, boardMoveMessage, capFinished } from '#shared/globalBoard'

// Finished tasks and threads shown per project until "Show all".
const FINISHED_SHOWN = 5
const COLUMN_KEY = 'boardColumn'

const router = useRouter()
const { board, cards, error } = useGlobalBoard()

const labels: Record<BoardColumn, string> = {
  blocked: t('Blocked'), todo: t('Todo'), ongoing: t('Ongoing'), finished: t('Finished'),
}
const showAll = ref(false)
const capped = computed(() => (showAll.value ? { cards: cards.value, hidden: 0 } : capFinished(cards.value, FINISHED_SHOWN)))
const columns = computed(() => BOARD_COLUMNS.map(id => ({
  id,
  label: labels[id],
  total: cards.value.filter(c => c.column === id).length,
  cards: capped.value.cards.filter(c => c.column === id),
})))

// Phone: the column shown, kept on this device.
function readColumn(): BoardColumn {
  try {
    const v = localStorage.getItem(COLUMN_KEY)
    if (BOARD_COLUMNS.includes(v as BoardColumn)) return v as BoardColumn
  } catch { /* storage unavailable */ }
  return 'blocked'
}
const phoneColumn = ref(readColumn())
function selectColumn(id: BoardColumn) {
  phoneColumn.value = id
  try { localStorage.setItem(COLUMN_KEY, id) }
  catch { /* storage unavailable */ }
}

const boardOf = (c: BoardCard) => (c.kind === 'task' ? board.value?.projects.find(p => p.panes.includes(c.coordinator.id))?.board ?? null : null)

function open(c: BoardCard) {
  if (c.kind === 'agent') navigateTo(panePath(c.pane.id))
  else if (c.kind === 'thread') openThread(c.coordinator, c.project || '', c.thread)
  else openProjectPanel(c.coordinator)
}

// ------------------------------------------------------------ moves
const lang = language === 'en' ? 'en' : 'fr'
// Moves need the coordinator's agent, a connection, and no other task message on its way.
const canMove = (c: TaskCard) => eventsOpen.value && !offlineView.value && !paneStale(c.coordinator) && Boolean(c.coordinator.agent) && !taskSending.value
// A task already sent (from here or the Project panel): no other move until the coordinator has edited TASKS.md.
const isSentTask = (c: TaskCard) => isTaskSent(c.coordinator.id, c.list, c.task.text)

async function move(c: TaskCard, m: BoardMove) {
  // The live card: a read may have moved or removed it since the menu opened or the drag began.
  const now = cards.value.find(x => x.key === c.key)
  if (now?.kind !== 'task' || !now.moves.some(x => x.action === m.action)) return
  const sent = await sendTask(now.coordinator.id, now.list, m.action, now.task.text, boardMoveMessage(m.action, now.task.text, lang))
  if (sent !== false) toast(t('Sent to the coordinator'))
}

// Drag and drop (computer): a column takes the card only when it is one of its moves.
// The drag carries its own type, so text or files dropped from elsewhere move nothing.
const DRAG_TYPE = 'application/x-wherdr-board-task'
const dragged = shallowRef<TaskCard | null>(null)
const overColumn = ref<BoardColumn | null>(null)
const moveTo = (id: BoardColumn) => dragged.value?.moves.find(m => m.to === id)
const ours = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes(DRAG_TYPE))
function onDragStart(c: TaskCard, e: DragEvent) {
  if (!canMove(c) || isSentTask(c) || !e.dataTransfer) return e.preventDefault()
  dragged.value = c
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(DRAG_TYPE, c.key)
  // Firefox starts no drag without data.
  e.dataTransfer.setData('text/plain', c.task.text)
}
function onDragEnd() {
  dragged.value = null
  overColumn.value = null
}
// A dragged card that a read removed fires no dragend: forget the drag.
watch(cards, (list) => {
  const c = dragged.value
  if (c && !list.some(x => x.key === c.key)) onDragEnd()
})
function onDragOver(id: BoardColumn, e: DragEvent) {
  if (!ours(e) || !moveTo(id)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  overColumn.value = id
}
function onDrop(id: BoardColumn, e: DragEvent) {
  const m = moveTo(id)
  const c = dragged.value
  onDragEnd()
  if (!ours(e) || !m || !c) return
  e.preventDefault()
  void move(c, m)
}

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
    </header>
    <OfflineNote v-if="offlineView && cachedAt" class="board-offline" :label="t('Last known state')" :at="cachedAt" date-style="medium" />
    <div v-if="error" class="notice board-notice">{{ error }}</div>
    <p v-else-if="!board && !offlineView" class="board-empty board-loading">{{ t('Loading…') }}</p>
    <div v-if="!desk" class="board-seg" role="group" :aria-label="t('Board')">
      <button
        v-for="col in columns" :key="col.id" type="button" class="board-seg-btn" :class="[col.id, { on: phoneColumn === col.id }]"
        :aria-pressed="phoneColumn === col.id" @click="selectColumn(col.id)"
      >
        <span>{{ col.label }}</span><b>{{ col.total }}</b>
      </button>
    </div>
    <div class="board-cols">
      <section
        v-for="col in columns" v-show="desk || phoneColumn === col.id" :key="col.id" class="board-col" :class="[col.id, { drop: dragged && moveTo(col.id), over: overColumn === col.id }]"
        :aria-label="col.label" @dragover="onDragOver(col.id, $event)" @dragleave.self="overColumn = null" @drop="onDrop(col.id, $event)"
      >
        <h3 v-if="desk" class="board-col-head"><span>{{ col.label }}</span><span class="pp-count">{{ col.total }}</span></h3>
        <div class="board-col-body">
          <BoardCard
            v-for="c in col.cards" :key="c.key" :card="c" :board="boardOf(c)"
            :sent="c.kind === 'task' && isSentTask(c)" :movable="c.kind === 'task' && canMove(c)" :draggable="desk && c.kind === 'task' && c.moves.length > 0 && canMove(c) && !isSentTask(c)"
            @open="open(c)" @move="m => c.kind === 'task' && move(c, m)" @dragstart="e => c.kind === 'task' && onDragStart(c, e)" @dragend="onDragEnd"
          />
          <p v-if="!col.cards.length" class="board-empty">{{ t('Nothing here') }}</p>
          <button v-if="col.id === 'finished' && capped.hidden" type="button" class="board-more" @click="showAll = true">
            {{ tl(`Show all (${capped.hidden} more)`, `Tout afficher (${capped.hidden} de plus)`) }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
