<script setup lang="ts">
// Herdr tab: plan (phone) or panes side by side (computer).
const route = useRoute()
const tabId = computed(() => String(route.params.tab || ''))
</script>

<template>
  <TabView :key="tabId" :tab-id="tabId" />
</template>
