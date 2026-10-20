<script setup lang="ts">
// One task on the Board: its key, title, what it says, and its tags (agent,
// progress, pull request, review). `status`: also its group, for lists that
// mix groups (grouped by repo); `machine`: its machine's name, where several
// machines share a list.
import { type TaskRow, prNumber, taskKey } from '#shared/projectsTasks'

const props = defineProps<{ task: TaskRow, status?: boolean, machine?: string, stale?: boolean, readAt?: string }>()
defineEmits<{ open: [] }>()

const meta = computed(() => [props.task.app, props.task.progress !== null && props.task.group === 'working' ? `${props.task.progress}%` : ''].filter(Boolean))
const staleTitle = computed(() => (props.stale
  ? (props.readAt ? tl(`As read at ${props.readAt}: see the note above`, `Lue à ${props.readAt} : voir la note plus haut`) : tl('An older read: see the note above', 'Lecture plus ancienne : voir la note plus haut'))
  : undefined))
</script>

<template>
  <button type="button" class="board-card task-card" :class="[task.group, { stale }]" :title="staleTitle" :data-task="task.id" @click="$emit('open')">
    <span class="board-card-head">
      <span class="task-key">{{ taskKey(task.id, task.repoKey) }}</span>
      <span v-if="status" class="task-state" :class="task.group">{{ taskGroupLabel(task.group) }}</span>
      <span v-if="machine" class="board-card-label">{{ machine }}</span>
    </span>
    <span class="board-card-title wrap">{{ task.title }}</span>
    <span v-if="task.msg" class="board-note">{{ task.msg }}</span>
    <span v-if="meta.length || task.pr || task.review" class="task-chips">
      <span v-for="m in meta" :key="m" class="task-chip">{{ m }}</span>
      <span v-if="task.pr" class="task-chip">{{ prNumber(task.pr) || 'PR' }}</span>
      <span v-if="task.review" class="task-chip" :class="task.review.pass === false ? 'fail' : task.review.pass ? 'pass' : ''">
        {{ task.review.pass === false ? tl('review failed', 'revue échouée') : tl('review', 'revue') }}{{ task.review.tally ? ` · ${task.review.tally}` : '' }}
      </span>
    </span>
  </button>
</template>
