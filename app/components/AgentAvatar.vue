<script setup lang="ts">
// Agent logo (table in app/utils/agentIcons.ts), its initial otherwise, >_ for a terminal.
// `coordinator`: a herdr-projects coordinator's own icon, in its agent's color,
// so it reads as a role at a glance while the agent stays recognizable;
// `icon`: that coordinator's kind (coordinatorKind), a bubble otherwise.
defineProps<{ agent: string | null | undefined, coordinator?: boolean, icon?: string }>()
</script>

<template>
  <div v-if="coordinator" class="avatar coord" :class="agent" :title="agent ? kindLabel(agent) : undefined"><UIcon :name="icon || 'i-lucide-message-square-text'" /></div>
  <div v-else-if="!agent" class="avatar shell">&gt;_</div>
  <div v-else-if="agentIcon(agent)" class="avatar" :class="agent"><UIcon :name="agentIcon(agent)!" /></div>
  <div v-else class="avatar">{{ agent[0]!.toUpperCase() }}</div>
</template>
