<script setup lang="ts">
// /preview: the landing page with the recommended changes (cursor-lit grid,
// live phone demo, running install, agents band), to compare with `/`.
useHead({ meta: [{ name: 'robots', content: 'noindex' }] })
</script>

<template>
  <HomePage :grid="1" preview />
</template>
