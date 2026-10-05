<script setup lang="ts">
// omp's console as wherdr draws a group of its tool calls (ChatView.vue
// `omp-console`, OmpTool.vue): "OMP · N ACTIONS · Σ time", then per call
// "❯ command   0.11s" and "# intent → counts". Past three calls, only the last
// three show under "⋯ N earlier actions". `live`: the last call runs: omp's
// braille spinner (app/utils/ompSpinner.ts), its intent shimmering, its
// elapsed time, and the ring gliding on the console's border.
import type { OmpAction } from '~/utils/heroDemo'

const props = defineProps<{ actions: readonly OmpAction[], live: boolean }>()

const SHOWN = 3
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const hidden = computed(() => Math.max(0, props.actions.length - SHOWN))
const rows = computed(() => props.actions.slice(hidden.value))
// omp's wall time: "0.03s" under a minute (app/utils/ompTool.ts ompWall).
const wall = (ms: number) => `${(ms / 1000).toFixed(2)}s`
const total = computed(() => props.actions.reduce((s, a) => s + a.ms, 0))

// Spinner frame and elapsed seconds of the running call.
const frame = ref(0)
const since = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
watch(() => [props.live, props.actions.length], () => {
  clearInterval(timer)
  frame.value = 0
  since.value = Date.now()
  if (!props.live || !import.meta.client || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  timer = setInterval(() => { frame.value++ }, 80)
}, { immediate: true })
onBeforeUnmount(() => clearInterval(timer))
const elapsed = computed(() => `${Math.floor(frame.value * 80 / 1000)}s`)
</script>

<template>
  <div class="tools omp-console" :class="{ live }">
    <div class="omp-console-head">
      <span class="omp-console-title">omp</span>
      <span>{{ actions.length }} actions</span>
      <span v-if="!live && total" class="omp-console-total">Σ {{ wall(total) }}</span>
    </div>
    <div v-if="hidden" class="omp-console-more">⋯ {{ hidden }} earlier actions</div>
    <div v-for="(a, i) in rows" :key="a.cmd" class="omp-tool" :class="{ live: live && i === rows.length - 1 }">
      <div class="omp-tool-head">
        <span class="omp-tool-line">
          <span class="omp-tool-glyph">{{ live && i === rows.length - 1 ? FRAMES[frame % FRAMES.length] : '❯' }}</span>
          <code class="omp-tool-cmd">{{ a.cmd }}</code>
          <span class="omp-tool-wall">{{ live && i === rows.length - 1 ? elapsed : wall(a.ms) }}</span>
        </span>
        <span class="omp-tool-sub">
          <UChatShimmer v-if="live && i === rows.length - 1" :text="`# ${a.intent}`" :duration="2.4" class="omp-tool-intent" />
          <span v-else class="omp-tool-intent"># {{ a.intent }}</span>
          <span v-if="a.meta && !(live && i === rows.length - 1)" class="omp-tool-result">→ {{ a.meta }}</span>
        </span>
      </div>
    </div>
  </div>
</template>
