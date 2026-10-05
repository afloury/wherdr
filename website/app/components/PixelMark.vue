<script setup lang="ts">
// A brand pixel drawing in currentColor: the ram (default) or a word in the
// pixel font (`text`). The drawing is never changed; animations only:
//   - `boot`: pixels appear one by one, swept like a scanline (top to bottom),
//     each one flashing in the accent colour first;
//   - `glow`: a Titanium-blue neon halo that breathes slowly;
//   - hover (of the mark or of its link): the halo brightens.
// The boot animation only fills *backwards*: once a pixel's animation is over
// (or never runs: prefers-reduced-motion, see main.css), nothing of it remains
// and the pixel is plain currentColor, exactly the app logo.
import { RAM, gridPixels, pixelText } from '~/utils/pixels'

const props = withDefaults(defineProps<{ text?: string, boot?: boolean, glow?: boolean }>(), { boot: true, glow: true })
const grid = computed(() => props.text ? pixelText(props.text) : RAM)
const pixels = computed(() => gridPixels(grid.value))
const width = computed(() => grid.value[0]!.length)
</script>

<template>
  <svg class="px-mark" :class="{ boot, glow }" :viewBox="`0 0 ${width} 7`" shape-rendering="crispEdges" role="img" :aria-label="text ?? 'wherdr'">
    <rect v-for="p in pixels" :key="`${p.x}-${p.y}`" :x="p.x" :y="p.y" width="1" height="1" fill="currentColor" :style="boot ? { animationDelay: `${p.delay}ms` } : undefined" />
  </svg>
</template>

<style scoped>
.px-mark { overflow: visible; transition: filter .3s ease; }
.px-mark.glow { animation: breathe 5.5s ease-in-out infinite; }
.px-mark.glow:hover, a:hover .px-mark.glow { animation: none; filter: drop-shadow(0 0 3px var(--accent)) drop-shadow(0 0 9px color-mix(in srgb, var(--accent) 70%, transparent)); }
@keyframes breathe {
  0%, 100% { filter: drop-shadow(0 0 0 transparent); }
  50% { filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 55%, transparent)); }
}
/* Hidden, then accent, then gone: no interpolated colour, no end state kept. */
.px-mark.boot rect { animation: px .3s linear backwards; }
@keyframes px {
  0% { opacity: 0; fill: var(--accent); animation-timing-function: steps(1, end); }
  35% { opacity: 1; fill: var(--accent); animation-timing-function: steps(1, end); }
  100% { opacity: 1; fill: var(--accent); }
}
@media (prefers-reduced-motion: reduce) {
  .px-mark.boot rect, .px-mark.glow { animation: none; }
}
</style>
