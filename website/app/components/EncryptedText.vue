<script setup lang="ts">
// "Encrypted text" (Inspira UI style, as in the app's conversation view): the
// text is scrambled with terminal glyphs, then decrypts from left to right.
// Each word keeps its real width (the real text holds the layout, the glyphs
// sit on top), so the line never jumps and words still wrap. The scrambled
// copy is aria-hidden. Nothing moves with prefers-reduced-motion.
import { scrambleFrame } from '~/utils/cipher'

const props = withDefaults(defineProps<{ text: string, delay?: number, duration?: number }>(), {
  delay: 0,
  duration: 1100,
})

const words = computed(() => props.text.split(' '))
// Per word, while it plays: the decrypted part (the text's own color) and the
// still scrambled glyphs (violet).
const frame = ref<[string, string][] | null>(null)
let raf = 0
let timer: ReturnType<typeof setTimeout> | undefined

function play() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const start = performance.now()
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / props.duration)
    if (p < 1) {
      const full = scrambleFrame(props.text, p, Math.random)
      const front = Math.floor(p * props.text.length)
      let at = 0
      frame.value = words.value.map((w) => {
        const done = Math.max(0, Math.min(w.length, front - at))
        const part: [string, string] = [full.slice(at, at + done), full.slice(at + done, at + w.length)]
        at += w.length + 1
        return part
      })
      raf = requestAnimationFrame(step)
    } else frame.value = null
  }
  raf = requestAnimationFrame(step)
}

onMounted(() => { timer = setTimeout(play, props.delay) })
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearTimeout(timer) })
</script>

<template>
  <span class="enc"><template v-for="(w, i) in words" :key="i"><span class="w"><span :class="{ hide: frame }">{{ w }}</span><span v-if="frame" class="glyphs" aria-hidden="true">{{ frame[i]![0] }}<span class="scrambled">{{ frame[i]![1] }}</span></span></span>{{ i < words.length - 1 ? ' ' : '' }}</template></span>
</template>

<style scoped>
.w { position: relative; display: inline-block; }
.hide { visibility: hidden; }
.glyphs { position: absolute; left: 0; top: 0; white-space: pre; }
.scrambled { color: var(--violet); }
</style>
