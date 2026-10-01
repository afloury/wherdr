<script setup lang="ts">
// App logo (pixel ram, same grid as the icons in
// server/assets/branding), in currentColor to follow the theme.
const G = [
  '.###........###.',
  '#...#.####.#...#',
  '#.#..######..#.#',
  '#..#.######.#..#',
  '.##..#.##.#..##.',
  '.....######.....',
  '......####......',
]
const d = G.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? `M${x} ${y}h1v1h-1z` : ''))).join('')
</script>

<template>
  <svg class="app-logo" viewBox="0 0 16 7" shape-rendering="crispEdges" role="img" aria-label="wherdr">
    <path fill="currentColor" :d="d" />
  </svg>
</template>
