<script setup lang="ts">
// omp's braille spinner, and the turn's elapsed time when the server read it
// (`since`). The timer only lives while the component is shown on a visible
// page; with reduced motion the glyph stays fixed and only the time moves,
// once a second. Back from a hidden page, glyph and time catch up at once.
import { ompElapsed, ompSpinnerDelay, ompSpinnerGlyph } from '~/utils/ompSpinner'

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
function tick() { now.value = Date.now() }
function run() {
  stop()
  const delay = ompSpinnerDelay(reducedMotion.value, pageVisible.value)
  if (delay === null) return
  tick()
  timer = setInterval(tick, delay)
}
onMounted(() => {
  watch(reducedMotion, () => { start.value = now.value = Date.now(); run() }, { immediate: true })
  watch(pageVisible, run)
})
onBeforeUnmount(stop)
</script>

<template>
  <span class="omp-spinner" aria-hidden="true">{{ glyph }}</span>
  <slot />
  <span v-if="elapsed" class="omp-elapsed">{{ elapsed }}</span>
</template>
