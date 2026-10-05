<script setup lang="ts">
// omp's running step under the conversation, as in its status line
// (ChatView.vue `chat-status`, OmpSpinner.vue): braille spinner, the step
// shimmering, the turn's elapsed time. The turn starts when this mounts.
const props = defineProps<{ text: string }>()
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const start = ref(0)
const now = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  start.value = now.value = Date.now()
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  timer = setInterval(() => { now.value = Date.now() }, 80)
})
onBeforeUnmount(() => clearInterval(timer))
const glyph = computed(() => (timer ? FRAMES[Math.floor((now.value - start.value) / 80) % FRAMES.length] : '⠿'))
// Elapsed like omp: "47s" (the demo's turns stay under a minute).
const elapsed = computed(() => `${Math.floor((now.value - start.value) / 1000)}s`)
</script>

<template>
  <div class="chat-status">
    <span class="omp-step-line"><span class="omp-spinner">{{ glyph }}</span><UChatShimmer :text="props.text" :duration="2.4" class="omp-step" /><span class="omp-elapsed">{{ elapsed }}</span></span>
  </div>
</template>
