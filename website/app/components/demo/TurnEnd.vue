<script setup lang="ts">
// End of an agent's turn (ChatView.vue `turn-end`): copy, reply, and its
// duration with the number of actions ("✓ 2 min 40 s · 3 actions").
defineProps<{ text: string }>()
</script>

<template>
  <div class="turn-end">
    <span class="turn-copy"><UIcon name="i-lucide-copy" /></span>
    <span class="msg-reply"><UIcon name="i-lucide-reply" />Reply</span>
    <span class="t">{{ text }}</span>
  </div>
</template>
