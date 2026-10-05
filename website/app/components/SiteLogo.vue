<script setup lang="ts">
// wherdr's pixel ram, same grid as the app logo (app/components/AppLogo.vue),
// in currentColor; the drawing is never changed. Animations only:
//   - `boot`: pixels appear one by one, swept like a scanline (top to bottom);
//   - `glow`: a Titanium-blue neon halo that breathes slowly;
//   - hover: the halo brightens.
// prefers-reduced-motion: the ram is shown still (main.css stops animations).
withDefaults(defineProps<{ boot?: boolean, glow?: boolean }>(), { boot: true, glow: true })
const G = [
  '.###........###.',
  '#...#.####.#...#',
  '#.#..######..#.#',
  '#..#.######.#..#',
  '.##..#.##.#..##.',
  '.....######.....',
  '......####......',
]
// Delay per pixel: row first (scanline), with a little jitter per column.
const pixels = G.flatMap((row, y) => [...row].flatMap((c, x) => c === '#'
  ? [{ x, y, delay: y * 70 + ((x * 37) % 5) * 18 }]
  : []))
</script>

<template>
  <svg class="ram" :class="{ boot, glow }" viewBox="0 0 16 7" shape-rendering="crispEdges" role="img" aria-label="wherdr">
    <rect v-for="p in pixels" :key="`${p.x}-${p.y}`" :x="p.x" :y="p.y" width="1" height="1" fill="currentColor" :style="{ animationDelay: `${p.delay}ms` }" />
  </svg>
</template>

<style scoped>
.ram { overflow: visible; transition: filter .3s ease; }
.ram.glow { animation: breathe 5.5s ease-in-out infinite; }
.ram.glow:hover, a:hover > .ram.glow { animation-play-state: paused; filter: drop-shadow(0 0 3px var(--accent)) drop-shadow(0 0 9px color-mix(in srgb, var(--accent) 70%, transparent)); }
@keyframes breathe {
  0%, 100% { filter: drop-shadow(0 0 0 transparent); }
  50% { filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 55%, transparent)); }
}
.ram.boot rect { animation: px .26s steps(2, end) both; }
@keyframes px {
  0% { opacity: 0; fill: var(--accent); }
  60% { opacity: 1; fill: var(--accent); }
  100% { opacity: 1; }
}
</style>
