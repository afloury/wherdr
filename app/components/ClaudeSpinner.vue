<script setup lang="ts">
// Étoile de Claude qui tourne (utils/spinner.ts). La minuterie ne vit que tant
// que le composant est affiché, et ne démarre pas si le système demande moins
// d'animations (glyphe fixe « ✻ »).
import { spinnerGlyph, SPINNER_MS } from '~/utils/spinner'

const elapsed = ref(0)
const glyph = computed(() => spinnerGlyph(elapsed.value, reducedMotion.value))
let timer: ReturnType<typeof setInterval> | undefined
let start = 0

function stop() {
  if (timer) clearInterval(timer)
  timer = undefined
}
function run(reduced: boolean) {
  stop()
  if (reduced) return
  start = performance.now()
  elapsed.value = 0
  timer = setInterval(() => { elapsed.value = performance.now() - start }, SPINNER_MS)
}
onMounted(() => watch(reducedMotion, run, { immediate: true }))
onBeforeUnmount(stop)
</script>

<template>
  <span class="claude-spinner" aria-hidden="true">{{ glyph }}</span>
</template>
