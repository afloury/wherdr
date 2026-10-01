<script setup lang="ts">
// Conversation image enlarged. When it belongs to a set (message with several
// images): ← → keys, swipe or the side buttons go through all of them, with a
// counter. A tap on the backdrop (or Escape) closes it.
const set = computed(() => lightboxSrc.value && lightboxSet.value.includes(lightboxSrc.value) ? lightboxSet.value : [])
const index = computed(() => lightboxSrc.value ? set.value.indexOf(lightboxSrc.value) : -1)
const multi = computed(() => set.value.length > 1)

function close() { lightboxSrc.value = null; lightboxSet.value = [] }
function go(delta: number) {
  if (!multi.value) return
  lightboxSrc.value = set.value[stepImage(index.value, delta, set.value.length)] ?? lightboxSrc.value
}
function onKey(e: KeyboardEvent) {
  if (!lightboxSrc.value) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
}

// Swipe: horizontal gesture changes image; a plain tap closes.
let start: { x: number, y: number, t: number } | null = null
let swiped = false
function onDown(e: PointerEvent) { start = { x: e.clientX, y: e.clientY, t: Date.now() }; swiped = false }
function onUp(e: PointerEvent) {
  if (!start || !multi.value) { start = null; return }
  const dx = e.clientX - start.x
  if (swipeAxis(dx, e.clientY - start.y) === 'x') {
    const step = swipeStep(dx, Date.now() - start.t, window.innerWidth)
    if (step) { go(step); swiped = true }
  }
  start = null
}
function onClick() { if (swiped) { swiped = false; return } close() }

onMounted(() => document.addEventListener('keydown', onKey))
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div v-if="lightboxSrc" class="lightbox" @click="onClick" @pointerdown="onDown" @pointerup="onUp">
    <img :src="lightboxSrc" alt="" draggable="false">
    <template v-if="multi">
      <span class="lightbox-count">{{ index + 1 }} / {{ set.length }}</span>
      <button type="button" class="lightbox-nav prev" :disabled="index <= 0" :aria-label="t('Previous image')" @click.stop="go(-1)"><UIcon name="i-lucide-chevron-left" /></button>
      <button type="button" class="lightbox-nav next" :disabled="index >= set.length - 1" :aria-label="t('Next image')" @click.stop="go(1)"><UIcon name="i-lucide-chevron-right" /></button>
    </template>
  </div>
</template>
