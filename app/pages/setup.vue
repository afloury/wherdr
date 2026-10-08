<script setup lang="ts">
// #/setup: opens the setup guide over the home screen (link opened by the
// Herdr plugin at its first install). #/setup?step=security opens it at that
// step: the "Continue on <tailnet address>" link of the guide on localhost.
const route = useRoute()
onMounted(() => {
  openOnboarding(route.query.step)
  navigateTo('/', { replace: true })
})
</script>

<template>
  <div />
</template>
