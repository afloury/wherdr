<script setup lang="ts">
// #/setup: opens the setup guide over the home screen (link opened by the
// Herdr plugin at its first install).
onMounted(() => {
  openOnboarding()
  navigateTo('/', { replace: true })
})
</script>

<template>
  <div />
</template>
