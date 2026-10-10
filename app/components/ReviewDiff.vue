<script setup lang="ts">
import type { ChangeFile } from '#shared/types'
import { matchesReview, reviewLines, type ReviewComment, type ReviewLine } from '#shared/review'
const props = defineProps<{ file: ChangeFile, scope: ReviewComment['scope'], comments: ReviewComment[] }>()
const emit = defineEmits<{ add: [scope: ReviewComment['scope'], path: string, line: ReviewLine], update: [id: string, body: string], remove: [id: string] }>()
const lines = computed(() => reviewLines(props.file.lines))
function notes(line: ReviewLine) { return props.comments.filter(c => c.scope === props.scope && c.path === props.file.path && matchesReview(c, line)) }
let down = { x: 0, y: 0 }
function open(event: MouseEvent, line: ReviewLine) {
  if (line.number === null || window.getSelection()?.toString()) return
  if (event.detail && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) return
  emit('add', props.scope, props.file.path, line)
}
</script>
<template>
  <div class="change-code" role="region" :aria-label="file.path">
    <template v-for="(line, i) in lines" :key="i">
      <div class="change-line review-line" :class="line.kind" @pointerdown="down = { x: $event.clientX, y: $event.clientY }" @click="open($event, line)">
        <button v-if="line.number !== null" type="button" class="review-gutter" :aria-label="`${t('Comment on line')} ${line.number}${line.side === 'old' ? ` (${t('old line')})` : ''}`" @click.stop="emit('add', scope, file.path, line)">{{ line.number }}<span aria-hidden="true">+</span></button>
        <span class="review-source">{{ line.text }}</span>
      </div>
      <ReviewNote v-for="note in notes(line)" :key="note.id" :comment="note" @update="(id, body) => emit('update', id, body)" @remove="emit('remove', $event)" />
    </template>
  </div>
</template>
