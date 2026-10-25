<script setup lang="ts">
// One task on the Board: its key, title and pull request, what it says on one
// line (the kind of wait first, links shortened), and its tags (agent,
// progress, review). `status`: also its group, for lists that mix groups
// (grouped by repo); `machine`: its machine's name, where several machines
// share a list. The whole card opens the task; its pull request link opens
// the pull request.
import { type TaskRow, prNumber, taskKey } from '#shared/projectsTasks'
import { blockKind, blockKindLabel, prLink } from '~/utils/blockNotice'

const props = defineProps<{ task: TaskRow, status?: boolean, machine?: string, stale?: boolean, readAt?: string }>()
defineEmits<{ open: [] }>()

const waitKind = computed(() => (props.task.group === 'needs' ? blockKind(props.task.kind) : null))
// One line: its words with their links kept (LinkedText shortens them).
const line = computed(() => (props.task.msg || '').replace(/\s+/g, ' ').trim())
const pr = computed(() => props.task.pr || prLink(props.task.msg || ''))
const meta = computed(() => [props.task.progress !== null && props.task.group === 'working' ? `${props.task.progress}%` : ''].filter(Boolean))
const staleTitle = computed(() => (props.stale
  ? (props.readAt ? tl(`As read at ${props.readAt}: see the note above`, `Lue à ${props.readAt} : voir la note plus haut`) : tl('An older read: see the note above', 'Lecture plus ancienne : voir la note plus haut'))
  : undefined))
</script>

<template>
  <div class="board-card task-card" :class="[task.group, { stale }]" :title="staleTitle" :data-task="task.id">
    <button type="button" class="task-card-open" :aria-label="`${taskKey(task.id, task.repoKey)} ${task.title}`" @click="$emit('open')" />
    <span class="board-card-head">
      <TaskAgentMark :identity="task.identity || { agent: task.app, reviewer: '', from: '' }" primary />
      <TaskKey :value="taskKey(task.id, task.repoKey)" />
      <span v-if="status" class="task-state" :class="task.group">{{ taskGroupLabel(task.group) }}</span>
      <span v-if="machine" class="board-card-label">{{ machine }}</span>
    </span>
    <span class="task-card-title">
      <span class="board-card-title wrap">{{ task.title }}</span>
      <a v-if="pr" class="task-chip task-card-pr" :href="pr" :title="pr" target="_blank" rel="noopener noreferrer">{{ prNumber(pr) ? `PR ${prNumber(pr)}` : 'PR' }}</a>
    </span>
    <span v-if="line" class="board-note task-card-msg" :title="task.msg">
      <span v-if="waitKind" class="task-needs-type" :data-kind="waitKind">{{ blockKindLabel(waitKind) }}</span>
      <span class="task-card-msg-text"><LinkedText :text="line" /></span>
    </span>
    <span v-if="task.chat || meta.length || task.review" class="task-chips">
      <span v-if="task.chat" class="task-chip">{{ tl('Conversation', 'Conversation') }}</span>
      <span v-for="m in meta" :key="m" class="task-chip">{{ m }}</span>
      <span v-if="task.review" class="task-chip" :class="task.review.pass === false ? 'fail' : task.review.pass ? 'pass' : ''">
        {{ task.review.pass === false ? tl('review failed', 'revue échouée') : tl('review', 'revue') }}{{ task.review.tally ? ` · ${task.review.tally}` : '' }}
      </span>
    </span>
  </div>
</template>
