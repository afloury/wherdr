<script setup lang="ts">
// Thumbnails of a message: wrapping grid, "+N" tile past the cap; a tap opens
// the viewer on the whole set of the message.
const props = defineProps<{ srcs: string[], offline?: boolean }>()
const layout = computed(() => thumbLayout(props.srcs.length))
function open(i: number) { openLightbox(props.srcs, i) }
</script>

<template>
  <span class="thumbs" :class="{ one: srcs.length === 1 }">
    <span v-for="(src, i) in srcs.slice(0, layout.shown)" :key="src">
      <span v-if="offline" class="offline-image">{{ t('Image unavailable offline') }}</span>
      <img v-else class="msg-img" :src="src" alt="" loading="lazy" decoding="async" @click="open(i)">
    </span>
    <button v-if="layout.more" type="button" class="thumb-more" :aria-label="tl(`Show all ${srcs.length} images`, `Voir les ${srcs.length} images`)" @click="open(layout.shown)">
      <img v-if="!offline" :src="srcs[layout.shown]" alt="" loading="lazy" decoding="async">
      <span>+{{ layout.more }}</span>
    </button>
  </span>
</template>
