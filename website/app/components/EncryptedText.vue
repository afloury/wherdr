<script setup lang="ts">
// Typewriter + encrypted text, as in the app's conversation view: a writing
// front lays down terminal glyphs from left to right, and a second front,
// a little behind, decrypts them into the real text. Each word keeps its
// real width (the real text holds the layout, the animated copy sits on top),
// so the line never jumps and words still wrap. The animated copy is
// aria-hidden. Nothing moves with prefers-reduced-motion.
import { TRAIL_GLYPHS as GLYPHS } from '~/utils/typing'

const props = withDefaults(defineProps<{ text: string, delay?: number, duration?: number }>(), {
  delay: 0,
  duration: 1100,
})

// Share of the duration by which decryption trails the writing.
const LAG = 0.3
const words = computed(() => props.text.split(' '))
// Per word, while it plays: the decrypted part, then the glyphs written but
// not yet decrypted; the rest of the word is not written yet.
const frame = ref<[string, string][] | null>(null)
let raf = 0
let timer: ReturnType<typeof setTimeout> | undefined

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const glyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!

function play() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const start = performance.now()
  const len = props.text.length
  frame.value = words.value.map(() => ['', ''])
  const step = (now: number) => {
    const p = (now - start) / props.duration
    if (p >= 1) {
      frame.value = null
      return
    }
    const written = Math.floor(clamp(p / (1 - LAG)) * len)
    const decrypted = Math.floor(clamp((p - LAG) / (1 - LAG)) * len)
    let at = 0
    frame.value = words.value.map((w) => {
      const done = Math.max(0, Math.min(w.length, decrypted - at))
      const typed = Math.max(done, Math.min(w.length, written - at))
      const part: [string, string] = [w.slice(0, done), Array.from({ length: typed - done }, glyph).join('')]
      at += w.length + 1
      return part
    })
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

onMounted(() => { timer = setTimeout(play, props.delay) })
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearTimeout(timer) })
</script>

<template>
  <span class="enc"><template v-for="(w, i) in words" :key="i"><span class="w"><span :class="{ hide: frame }">{{ w }}</span><span v-if="frame" class="glyphs" aria-hidden="true">{{ frame[i]![0] }}{{ frame[i]![1] }}</span></span>{{ i < words.length - 1 ? ' ' : '' }}</template></span>
</template>

<style scoped>
.w { position: relative; display: inline-block; }
.hide { visibility: hidden; }
.glyphs { position: absolute; left: 0; top: 0; white-space: pre; }
</style>
