<script setup lang="ts">
// Logo de l'app (bélier pixel, même grille que les icônes de
// server/assets/branding), en currentColor pour suivre le thème.
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
