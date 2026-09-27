<script setup lang="ts">
// Vue d'un agent (ou d'un terminal) : une instance par pane.
const route = useRoute()
const paneId = computed(() => String(route.params.pane || ''))
</script>

<template>
  <AgentView :key="paneId" :pane-id="paneId" />
</template>
