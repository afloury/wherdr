<script setup lang="ts">
// A message the user sent, right-aligned, with its delivery line
// (`queued` = amber "Queued · sending…").
defineProps<{ text: string, meta?: string, queued?: boolean }>()
</script>

<template>
  <div class="user">
    <div class="bubble">{{ text }}</div>
    <div v-if="meta" class="meta" :class="{ queued }">{{ meta }}</div>
  </div>
</template>

<style scoped>
.user { display: flex; flex-direction: column; align-items: flex-end; }
.bubble { max-width: 82%; padding: calc(var(--u) * 10) calc(var(--u) * 14); background: var(--surface-2); border: 1px solid var(--line-strong); color: var(--text); }
.meta { margin-top: calc(var(--u) * 6); font: calc(var(--u) * 12) / 1.3 var(--mono); color: var(--dim); }
.meta.queued { color: var(--amber); }
</style>
