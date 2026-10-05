<script setup lang="ts">
// Thin bar above the header of /grid/1…5: which variant this is, and
// previous / next (also with the ← → keys).
import { GRID_VARIANTS, gridNeighbours } from '~/utils/grid'

const props = defineProps<{ n: number }>()
const nb = computed(() => gridNeighbours(props.n))
const name = computed(() => GRID_VARIANTS.find(v => v.n === props.n)?.name ?? '')

function onKey(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const t = e.target as HTMLElement | null
  if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
  if (e.key === 'ArrowLeft') navigateTo(`/grid/${nb.value.prev}`)
  else if (e.key === 'ArrowRight') navigateTo(`/grid/${nb.value.next}`)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <nav class="gs" aria-label="Grid variants">
    <div class="wrap gs-in">
      <span class="label"><span class="k">Grid variant {{ n }}/{{ GRID_VARIANTS.length }}</span> · {{ name }}</span>
      <span class="gs-nav">
        <NuxtLink :to="`/grid/${nb.prev}`" class="gs-btn" :aria-label="`Previous variant (${nb.prev})`">←</NuxtLink>
        <NuxtLink v-for="v in GRID_VARIANTS" :key="v.n" :to="`/grid/${v.n}`" class="gs-btn num" :aria-current="v.n === n ? 'page' : undefined" :aria-label="`Variant ${v.n}: ${v.name}`">{{ v.n }}</NuxtLink>
        <NuxtLink :to="`/grid/${nb.next}`" class="gs-btn" :aria-label="`Next variant (${nb.next})`">→</NuxtLink>
        <NuxtLink to="/" class="gs-btn ref">Current</NuxtLink>
      </span>
    </div>
  </nav>
</template>

<style scoped>
.gs { border-bottom: 1px solid var(--line); background: var(--bg-2); }
.gs-in { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 36px; }
.gs .label { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gs-nav { display: flex; flex: none; }
.gs-btn {
  display: grid; place-items: center; min-width: 28px; height: 24px; padding: 0 6px;
  border: 1px solid var(--line); margin-left: -1px;
  font: 600 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted); text-decoration: none;
}
.gs-btn:hover { color: var(--text); border-color: var(--line-strong); position: relative; }
.gs-btn[aria-current="page"] { color: var(--on-accent); background: var(--accent); border-color: var(--accent); position: relative; }
.gs-btn.ref { margin-left: 8px; }
@media (max-width: 520px) {
  .gs-btn.num { display: none; }
}
</style>
