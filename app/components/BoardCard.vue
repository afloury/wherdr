<script setup lang="ts">
// One card of the Board (BoardView): a project, a herdr-projects thread, a TASKS.md
// task or an agent pane. Read-only, except the task's "Move to…" menu; the parent
// decides what a click opens and sends the moves.
import type { BoardCard as Card, BoardColumn, BoardMove } from '#shared/globalBoard'
import type { ProjectBoard } from '#shared/projectBoard'
import { BOARD_COLUMNS } from '#shared/globalBoard'

const props = defineProps<{
  card: Card
  // The project's board, for the thread badges of a task.
  board: ProjectBoard | null
  // Task already sent to the coordinator: no further move until the next read.
  sent: boolean
  // Moves allowed now (online, machine reachable): a menu, otherwise a disabled button.
  movable: boolean
  // Computer: the card can be dragged to another column.
  draggable: boolean
}>()
const emit = defineEmits<{ open: [], move: [move: BoardMove], dragstart: [e: DragEvent], dragend: [] }>()

const columnLabels: Record<BoardColumn, string> = {
  blocked: t('Blocked'), todo: t('Todo'), ongoing: t('Ongoing'), finished: t('Finished'),
}
const stale = computed(() => {
  const c = props.card
  if (c.kind === 'agent') return paneStale(c.pane)
  if (c.kind === 'project') return c.stale || paneStale(c.coordinator)
  return paneStale(c.coordinator)
})
const where = computed(() => {
  const c = props.card
  const pane = c.kind === 'agent' ? c.pane : c.coordinator
  // The machine is named for a pane that is not on this one.
  return [c.kind === 'project' ? '' : c.project, pane.machine ? machineName(pane.machine) : ''].filter(Boolean).join(' · ')
})
const moveItems = (): MenuItem[] => (props.card.kind === 'task' ? props.card.moves.map(m => ({ label: columnLabels[m.to], run: () => emit('move', m) })) : [])
// The card's name for screen readers and the keyboard: its open button.
const openLabel = computed(() => {
  const c = props.card
  if (c.kind === 'project') return c.project || ''
  if (c.kind === 'thread') return `${c.thread.id.toUpperCase()} · ${c.thread.title}`
  if (c.kind === 'task') return c.task.text
  return paneTitle(c.pane)
})
// A click anywhere on the card opens it, except on its own links, badges, code and menu.
function onClick(e: MouseEvent) {
  if ((e.target as Element | null)?.closest('a, button, .pp-code')) return
  emit('open')
}
</script>

<template>
  <div
    class="board-card" :class="[card.kind, { stale, sent, 'is-draggable': draggable }]"
    :draggable="draggable" @click="onClick" @dragstart="emit('dragstart', $event)" @dragend="emit('dragend')"
  >
    <button type="button" class="board-card-open sr-only" :aria-label="openLabel" @click="emit('open')" />
    <template v-if="card.kind === 'project'">
      <div class="board-card-head">
        <UIcon name="i-lucide-folder" class="board-card-icon" />
        <span class="board-card-title">{{ card.project }}</span>
        <StatusPill :pane="card.coordinator" />
      </div>
      <ul class="board-counts">
        <li v-for="c in BOARD_COLUMNS" :key="c" :class="[c, { zero: !card.counts[c] }]"><b>{{ card.counts[c] }}</b> {{ columnLabels[c] }}</li>
      </ul>
      <p v-if="card.stale" class="board-note">{{ t('Last known state') }}</p>
      <p v-if="card.error" class="board-note error">{{ t(card.error) }}</p>
    </template>

    <template v-else-if="card.kind === 'thread'">
      <span class="board-card-title wrap">{{ card.thread.title }}</span>
      <span class="pill" :class="threadClass(card.thread)"><i />{{ threadLabel(card.thread) }}</span>
      <span class="pp-meta">{{ threadMeta(card.thread) }}</span>
    </template>

    <template v-else-if="card.kind === 'task'">
      <div class="board-task-row">
        <span class="pp-box" />
        <span class="pp-task-text"><TaskText :text="card.task.text" :pane-id="card.coordinator.id" /></span>
        <span v-if="sent" class="pp-sent"><UIcon name="i-lucide-send" />{{ t('Sent') }}</span>
        <template v-else-if="card.moves.length">
          <SpaceMenu v-if="movable" :items="moveItems" :title="t('Move to…')" :label="t('Move to…')" size="sm" />
          <UButton v-else icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="sm" class="icon-btn" :aria-label="t('Move to…')" disabled @click.stop />
        </template>
      </div>
      <p v-if="card.task.reason" class="pp-reason">{{ card.task.reason }}</p>
      <span v-if="card.task.badges?.length" class="pp-task-foot">
        <TaskBadges :badges="card.task.badges" :coordinator="card.coordinator" :board="board" />
      </span>
      <span v-if="card.listTitle" class="board-card-label">{{ card.listTitle }}</span>
    </template>

    <template v-else-if="card.kind === 'agent'">
      <div class="board-card-head">
        <AgentAvatar :agent="card.pane.agent" />
        <span class="board-card-title">{{ paneTitle(card.pane) }}</span>
      </div>
      <StatusPill :pane="card.pane" />
    </template>

    <span v-if="where" class="board-card-where">{{ where }}</span>
  </div>
</template>
