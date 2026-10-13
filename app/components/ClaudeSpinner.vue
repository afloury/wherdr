<script setup lang="ts">
// Claude's spinning star (utils/spinner.ts). The timer only lives while
// the component is shown on a visible page, and does not start if the system
// asks for reduced motion (fixed "✻" glyph). Back from a hidden page, the
// star resumes on the frame it would have reached.
import { spinnerDelay, spinnerGlyph } from '~/utils/spinner'

const elapsed = ref(0)
const glyph = computed(() => spinnerGlyph(elapsed.value, reducedMotion.value))
let timer: ReturnType<typeof setInterval> | undefined
let start = 0

function stop() {
  if (timer) clearInterval(timer)
  timer = undefined
}
function tick() { elapsed.value = performance.now() - start }
function run() {
  stop()
  const delay = spinnerDelay(reducedMotion.value, pageVisible.value)
  if (delay === null) return
  tick()
  timer = setInterval(tick, delay)
}
onMounted(() => {
  watch(reducedMotion, () => { start = performance.now(); run() }, { immediate: true })
  watch(pageVisible, run)
})
onBeforeUnmount(stop)
</script>

<template>
  <span class="claude-spinner" aria-hidden="true">{{ glyph }}</span>
</template>
