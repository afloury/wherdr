<script setup lang="ts">
// Agent logo (table in app/utils/agentIcons.ts), its initial otherwise, >_ for a terminal.
defineProps<{ agent: string | null | undefined }>()
</script>

<template>
  <div v-if="!agent" class="avatar shell">&gt;_</div>
  <div v-else-if="agentIcon(agent)" class="avatar" :class="agent"><UIcon :name="agentIcon(agent)!" /></div>
  <div v-else class="avatar">{{ agent[0]!.toUpperCase() }}</div>
</template>
