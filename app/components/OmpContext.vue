<script setup lang="ts">
import type { Pane } from '#shared/types'
import { parseOmpContext } from '~/utils/meters'

const props = defineProps<{ pane: Pane, compact?: boolean }>()
const context = computed(() => parseOmpContext(props.pane.ompStatus?.meters))
const stale = computed(() => props.pane.status !== 'working' || props.pane.ompStatus?.metersFresh !== true)
const open = ref(false)
const label = computed(() => {
  const c = context.value
  if (!c) return ''
  const detail = tl(`Context: ${c.pct}% of ${c.total.toLocaleString()} tokens. Approximately ${Math.round(c.estimated).toLocaleString()} tokens, estimated from the rounded percentage.`, `Contexte : ${c.pct} % de ${c.total.toLocaleString()} tokens. Environ ${Math.round(c.estimated).toLocaleString()} tokens, estimés à partir du pourcentage arrondi.`)
  return stale.value ? `${detail} ${tl('Last reading; not live.', 'Dernière mesure ; pas en direct.')}` : detail
})
</script>

<template>
  <span v-if="context && compact" class="omp-context-progress" :class="{ 'last-known': stale, mid: context.pct >= 60, hi: context.pct >= 85 }"
    role="progressbar" :aria-label="label" :aria-valuenow="Math.min(context.pct, 100)" aria-valuemin="0" aria-valuemax="100" :style="{ width: `${Math.min(context.pct, 100)}%` }" />
  <span v-else-if="context" class="model-pick-wrap omp-context-wrap" @click.stop @pointerdown.stop>
    <UPopover v-model:open="open" :content="{ side: 'top', align: 'center' }">
      <button type="button" class="model-pick omp-context" :title="label" :aria-label="label">
        {{ Math.round(context.pct) }}% · {{ Math.round(context.estimated / 1000) }}K
      </button>
      <template #content>
        <div class="omp-context-detail" role="status" tabindex="0" @keydown.esc.stop.prevent="open = false">
          <p>{{ label }}</p>
          <p v-if="pane.ompStatus?.line" class="omp-context-status">{{ pane.ompStatus.line }}</p>
          <p v-if="pane.ompStatus?.meters" class="omp-context-status">{{ pane.ompStatus.meters }}</p>
        </div>
      </template>
    </UPopover>
  </span>
</template>

<style scoped>
.omp-context-progress { position: absolute; left: 0; bottom: 0; height: 2px; pointer-events: none; background: var(--green); }
.omp-context-progress.mid { background: var(--ochre); }
.omp-context-progress.hi { background: var(--rose); }
.omp-context-progress.last-known { opacity: .5; }
.omp-context { position: relative; white-space: nowrap; font-variant-numeric: tabular-nums; cursor: pointer; }
.omp-context::after { content: ''; position: absolute; inset: -6px 0; }
.omp-context-detail { width: min(300px, 80vw); padding: 10px; color: var(--text); font-size: 12px; white-space: normal; overflow-wrap: anywhere; }
.omp-context-status { margin-top: 8px; color: var(--muted); font-family: var(--mono); }
</style>
