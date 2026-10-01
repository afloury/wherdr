<script setup lang="ts">
// View of an agent (or a terminal): one instance per pane.
const route = useRoute()
const paneId = computed(() => String(route.params.pane || ''))
</script>

<template>
  <AgentView :key="paneId" :pane-id="paneId" />
</template>
