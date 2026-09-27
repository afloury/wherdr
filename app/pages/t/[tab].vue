<script setup lang="ts">
// Onglet Herdr : plan (téléphone) ou panes côte à côte (ordinateur).
const route = useRoute()
const tabId = computed(() => String(route.params.tab || ''))
</script>

<template>
  <TabView :key="tabId" :tab-id="tabId" />
</template>
