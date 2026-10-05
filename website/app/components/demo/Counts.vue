<script setup lang="ts">
// The three counters at the top of wherdr's agent list (app/components/HomeView.vue
// `stats`): your turn, working, ready (done + idle); zeros dimmed.
import type { AgentState } from '~/utils/demoScript'

const props = defineProps<{ agents: readonly { state: AgentState }[] }>()
const stats = computed(() => {
  const n = (s: AgentState) => props.agents.filter(a => a.state === s).length
  return [
    { s: 'blocked', n: n('blocked'), label: 'your turn' },
    { s: 'working', n: n('working'), label: 'working' },
    { s: 'done', n: n('done') + n('idle'), label: 'ready' },
  ]
})
</script>

<template>
  <div class="stats">
    <div v-for="c in stats" :key="c.s" class="stat" :class="[c.s, { zero: !c.n }]">
      <b>{{ c.n }}</b>
      <span><i />{{ c.label }}</span>
    </div>
  </div>
</template>
