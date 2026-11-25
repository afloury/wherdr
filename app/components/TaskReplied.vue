<script setup lang="ts">
// The user answered the task's agent in its own session (Card.replied): a muted
// line, "You replied to the agent at 14:32: <first words>", in the review entry
// and the task's sheet. The server clears it once the agent reports after the
// reply, so the entry then shows the new report. It never changes the step.
import type { Card } from '#shared/pm/board'

const props = defineProps<{ replied: NonNullable<Card['replied']> }>()
const line = computed(() => `${tl(`You replied to the agent at ${fmtTime(props.replied.at)}`)}${props.replied.said ? `: ${props.replied.said}` : ''}`)
</script>

<template>
  <p class="task-replied" data-testid="task-replied">{{ line }}</p>
</template>

<style scoped>
.task-replied { margin: 0; color: var(--muted); font: 12px/1.4 var(--mono); overflow-wrap: anywhere; }
</style>
