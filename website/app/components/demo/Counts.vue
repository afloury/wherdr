<script setup lang="ts">
// The three counters at the top of wherdr's agent list, counted from `agents`.
import type { AgentState } from '~/utils/demoScript'

const props = defineProps<{ agents: readonly { state: AgentState }[] }>()
const counts = computed(() => {
  const n: Record<AgentState, number> = { turn: 0, work: 0, ready: 0 }
  for (const a of props.agents) n[a.state]++
  return n
})
</script>

<template>
  <div class="counts">
    <div class="cnt turn"><b>{{ counts.turn }}</b><span><i class="demo-sq" />Your turn</span></div>
    <div class="cnt"><b>{{ counts.work }}</b><span><i class="demo-sq work" />Working</span></div>
    <div class="cnt"><b>{{ counts.ready }}</b><span><i class="demo-sq ready" />Ready</span></div>
  </div>
</template>

<style scoped>
.counts { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); }
.cnt { padding: calc(var(--u) * 10) calc(var(--u) * 12); border-right: 1px solid var(--line); }
.cnt:last-child { border-right: 0; }
.cnt b { display: block; font: 800 calc(var(--u) * 26) / 1.1 var(--display); color: #fff; }
.cnt.turn b { color: var(--rose); }
.cnt span { display: flex; align-items: center; font: 600 calc(var(--u) * 10) / 1.6 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
.cnt.turn .demo-sq { color: var(--amber); }
.work { color: var(--violet); }
.ready { color: var(--green); }
</style>
