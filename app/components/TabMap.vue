<script setup lang="ts">
// Mini-map of a tab: its panes in Herdr's proportions. The current cell
// is filled; a waiting agent is tinted (pink), a working agent marked.
import type { Pane } from '#shared/types'
import { type TabLayout, paneBoxes } from '#shared/layout'

const props = defineProps<{ layout: TabLayout, panes: Pane[], current?: string | null }>()
const byId = computed(() => new Map(props.panes.map(p => [p.id, p])))
const boxes = computed(() => paneBoxes(props.layout).map((b) => {
  const p = byId.value.get(b.pane)
  return { ...b, status: p ? statusKey(p) : 'shell' }
}))
</script>

<template>
  <span class="tabmap" aria-hidden="true">
    <i
      v-for="b in boxes" :key="b.pane" :class="[b.status, { cur: b.pane === current }]"
      :style="{ left: `${b.left}%`, top: `${b.top}%`, width: `${b.width}%`, height: `${b.height}%` }"
    />
  </span>
</template>
