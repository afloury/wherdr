<script setup lang="ts">
// A message the user sent (ChatView.vue `msg-user-wrap`): square block on the
// right. `phase`: "queued" = dashed block + "Queued · sending…", "sent" =
// "Sent · read by the agent", otherwise its time, once in the transcript.
defineProps<{ text: string, phase?: 'queued' | 'sent', time?: string }>()
</script>

<template>
  <div class="msg-user-wrap">
    <div class="msg-bubble" :class="{ queued: phase === 'queued' }">{{ text }}</div>
    <div v-if="phase === 'queued'" class="queued-tag"><UIcon name="i-lucide-clock" /><span>Queued · sending…</span></div>
    <div v-else-if="phase === 'sent'" class="queued-tag"><UIcon name="i-lucide-check" /><span>Sent · read by the agent</span></div>
    <div v-else-if="time" class="msg-time">{{ time }}</div>
  </div>
</template>
