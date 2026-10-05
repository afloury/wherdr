<script setup lang="ts">
// An agent in wherdr's list: logo, name, optional tag (COORDINATOR, T-0001),
// state, model, and the last line of its conversation.
import { STATE_LABEL } from '~/utils/demoScript'
import type { DemoAgent } from '~/utils/demoScript'

defineProps<{ agent: DemoAgent, active?: boolean }>()
</script>

<template>
  <div class="card" :class="{ active }">
    <span class="logo"><UIcon :name="agent.icon" /></span>
    <div class="main">
      <div class="name">{{ agent.name }}</div>
      <div class="state">
        <span v-if="agent.tag" class="tag">{{ agent.tag }}</span>
        <span :class="`demo-${agent.state}`"><i class="demo-sq" />{{ STATE_LABEL[agent.state] }}</span>
        <span class="demo-dim">· {{ agent.model }}</span>
      </div>
      <div class="line">{{ agent.line }}</div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.card { display: flex; gap: calc(var(--u) * 12); padding: calc(var(--u) * 12); border: 1px solid var(--line); background: var(--bg); transition: background .3s, box-shadow .3s; }
.card.active { background: var(--surface); box-shadow: inset 2px 0 0 var(--accent); }
.logo { flex: none; display: grid; place-items: center; width: calc(var(--u) * 34); height: calc(var(--u) * 34); border: 1px solid var(--line); background: var(--surface); font-size: calc(var(--u) * 20); }
.main { min-width: 0; flex: 1; }
.name { font: 700 calc(var(--u) * 16) / 1.3 var(--sans); color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.state { display: flex; align-items: center; gap: calc(var(--u) * 6); font: 500 calc(var(--u) * 12) / 1.7 var(--mono); white-space: nowrap; overflow: hidden; }
.state > span { display: inline-flex; align-items: center; transition: color .3s; }
.tag { padding: 0 calc(var(--u) * 6); border: 1px solid var(--line-strong); font-size: calc(var(--u) * 10); letter-spacing: .12em; color: var(--muted); }
.line { margin-top: calc(var(--u) * 4); font-size: calc(var(--u) * 13); line-height: 1.45; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
