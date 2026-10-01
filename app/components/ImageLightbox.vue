<script setup lang="ts">
// Conversation image enlarged; a tap (or Escape) closes it.
function close() { lightboxSrc.value = null }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && lightboxSrc.value) close() }
onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="lightboxSrc" class="lightbox" @click="close"><img :src="lightboxSrc" alt=""></div>
</template>
