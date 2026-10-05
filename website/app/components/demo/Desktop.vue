<script setup lang="ts">
// wherdr on a computer: agent sidebar (counters and cards), the open agent's
// header with the Conversation / Terminal switch, the main column (default
// slot) and an optional right panel (`aside` slot). Laid out for a window
// `width` CSS pixels wide (1440 by default; smaller = larger text), and sets
// `--u` = one of those pixels, for every demo piece inside.
import { STATE_LABEL } from '~/utils/demoScript'
import type { AgentState, DemoAgent } from '~/utils/demoScript'

defineProps<{
  agents: readonly DemoAgent[]
  active: string
  title: { name: string, state: AgentState, sub: string }
  terminal?: boolean
  width?: number
}>()
</script>

<template>
  <div class="dd" :style="{ '--u': `calc(100cqw / ${width ?? 1440})` }">
    <aside class="side">
      <div class="brand"><PixelMark class="mark" :boot="false" :glow="false" /> WHERDR · HERDR 0.9.1</div>
      <div class="title">Agents</div>
      <DemoCounts :agents="agents" />
      <div class="list">
        <DemoAgentCard v-for="a in agents" :key="a.name" :agent="a" :active="a.name === active" />
      </div>
    </aside>

    <section class="main">
      <header class="top">
        <div class="who">
          <div class="name">{{ title.name }}</div>
          <div class="state"><span :class="`demo-${title.state}`"><i class="demo-sq" />{{ STATE_LABEL[title.state] }}</span> <span class="demo-dim">· {{ title.sub }}</span></div>
        </div>
        <div class="modes"><span class="mode" :class="{ on: !terminal }">Conversation</span><span class="mode" :class="{ on: terminal }">Terminal</span></div>
        <div class="tools">
          <UIcon name="i-lucide-plus" class="ic" />
          <UIcon name="i-lucide-search" class="ic" />
          <UIcon name="i-lucide-ellipsis" class="ic" />
        </div>
      </header>
      <div class="content">
        <div class="col" :class="{ narrow: !$slots.aside }"><slot /></div>
        <aside v-if="$slots.aside" class="panel"><slot name="aside" /></aside>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dd {
  position: absolute; inset: 0; display: flex;
  background: var(--bg); color: var(--text); font: calc(var(--u) * 16) / 1.5 var(--sans);
  text-align: left; user-select: none;
}
.ic { width: calc(var(--u) * 20); height: calc(var(--u) * 20); color: var(--text); }

.side {
  flex: none; width: calc(var(--u) * 340); padding: calc(var(--u) * 18) calc(var(--u) * 14);
  display: flex; flex-direction: column; gap: calc(var(--u) * 14);
  border-right: 1px solid var(--line); background: var(--bg-2); overflow: hidden;
}
.brand { display: flex; align-items: center; gap: calc(var(--u) * 10); font: 600 calc(var(--u) * 11) / 1 var(--mono); letter-spacing: .14em; color: var(--accent); }
.mark { width: calc(var(--u) * 26); height: auto; color: #fff; }
.title { font: 800 calc(var(--u) * 34) / 1 var(--display); color: #fff; letter-spacing: -.02em; }
.list { display: flex; flex-direction: column; gap: calc(var(--u) * 8); margin-top: calc(var(--u) * 6); }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.top { flex: none; display: flex; align-items: center; gap: calc(var(--u) * 20); height: calc(var(--u) * 64); padding: 0 calc(var(--u) * 20); border-bottom: 1px solid var(--line); }
.who { flex: 1; min-width: 0; }
.name { font: 700 calc(var(--u) * 20) / 1.2 var(--sans); color: #fff; }
.state { display: flex; align-items: center; gap: calc(var(--u) * 6); font: 500 calc(var(--u) * 12) / 1.5 var(--mono); white-space: nowrap; overflow: hidden; }
.state > span:first-child { display: inline-flex; align-items: center; transition: color .3s; }
.modes { display: flex; border: 1px solid var(--line-strong); font: 600 calc(var(--u) * 11) / 1 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.mode { padding: calc(var(--u) * 8) calc(var(--u) * 18); color: var(--muted); transition: background .25s, color .25s; }
.mode.on { background: var(--accent); color: var(--on-accent); }
.tools { display: flex; gap: calc(var(--u) * 22); }

.content { flex: 1; min-height: 0; display: flex; }
.col.narrow { flex: none; width: 100%; max-width: calc(var(--u) * 868); margin: 0 auto; border-left: 1px solid var(--line); border-right: 1px solid var(--line); }
.col {
  flex: 1; min-width: 0; display: flex; flex-direction: column;
  padding: 0 calc(var(--u) * 24) calc(var(--u) * 20);
}
.panel { flex: none; width: calc(var(--u) * 380); border-left: 1px solid var(--line); background: var(--bg); overflow: hidden; }
</style>
