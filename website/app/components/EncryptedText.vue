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
const frame = ref<string[] | null>(null)
let raf = 0
let timer: ReturnType<typeof setTimeout> | undefined

function play() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const start = performance.now()
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / props.duration)
    frame.value = p < 1 ? scrambleFrame(props.text, p, Math.random).split(' ') : null
    if (p < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

onMounted(() => { timer = setTimeout(play, props.delay) })
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearTimeout(timer) })
</script>

<template>
  <span class="enc"><template v-for="(w, i) in words" :key="i"><span class="w"><span :class="{ hide: frame }">{{ w }}</span><span v-if="frame" class="glyphs" aria-hidden="true">{{ frame[i] }}</span></span>{{ i < words.length - 1 ? ' ' : '' }}</template></span>
</template>

<style scoped>
.w { position: relative; display: inline-block; }
.hide { visibility: hidden; }
.glyphs { position: absolute; left: 0; top: 0; white-space: pre; }
</style>
