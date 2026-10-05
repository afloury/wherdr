<script setup lang="ts">
// /preview: the landing page with the recommended changes (dotted grid with
// packets, live phone demo, running install), to compare with `/`.
useHead({ meta: [{ name: 'robots', content: 'noindex' }] })
</script>

<template>
  <HomePage :grid="5" preview />
</template>
