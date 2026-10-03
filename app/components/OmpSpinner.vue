<script setup lang="ts">
// omp's braille spinner, and the turn's elapsed time when the server read it
// (`since`). The timer only lives while the component is shown; with reduced
// motion the glyph stays fixed and only the time moves, once a second.
import { OMP_SPINNER_MS, ompElapsed, ompSpinnerGlyph } from '~/utils/ompSpinner'

const props = defineProps<{ since?: number | null }>()
const start = ref(0)
const now = ref(Date.now())
const glyph = computed(() => ompSpinnerGlyph(now.value - start.value, reducedMotion.value))
const elapsed = computed(() => (props.since ? ompElapsed(props.since, now.value) : ''))
let timer: ReturnType<typeof setInterval> | undefined

function stop() {
  if (timer) clearInterval(timer)
  timer = undefined
}
function run(reduced: boolean) {
  stop()
  start.value = now.value = Date.now()
  timer = setInterval(() => { now.value = Date.now() }, reduced ? 1000 : OMP_SPINNER_MS)
}
onMounted(() => watch(reducedMotion, run, { immediate: true }))
onBeforeUnmount(stop)
</script>

<template>
  <span class="omp-spinner" aria-hidden="true">{{ glyph }}</span>
  <slot />
  <span v-if="elapsed" class="omp-elapsed">{{ elapsed }}</span>
</template>
