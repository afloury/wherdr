<script setup lang="ts">
// Story 1.2, right phone: wherdr's agent list. The agent that
// pushed its question shows the options on its card; one tap answers without
// opening the conversation, and the agent goes back to work, then is done.
// Same PHONE clock as NotifyDemo.
import { OPTIONS, PICKED, QUESTION } from '~/utils/heroDemo'
import { PHONE } from '~/utils/storyDemos'
import type { DemoAgent } from '~/utils/demoScript'

const root = ref<HTMLElement | null>(null)
const { step } = useDemoClock(PHONE, root)

const lead = computed<DemoAgent>(() => {
  const s = step.value
  const base = { name: 'acme-api', icon: 'i-herdr-omp', model: 'GPT-5.5 high' }
  if (s >= 5) return { ...base, state: 'ready', line: 'The cache keeps users for 5 minutes. 16 tests pass.' }
  if (s >= 4) return { ...base, state: 'work', line: '❯ edit src/users.js  +2 −1' }
  if (s >= 3) return { ...base, state: 'work', line: 'You: 2. 5 minutes' }
  if (s >= 1) return { ...base, state: 'turn', line: QUESTION }
  return { ...base, state: 'work', line: '❯ bash npm test  ✓ 14 passed' }
})
const agents = computed<DemoAgent[]>(() => [
  lead.value,
  { name: 'web-shop', icon: 'i-herdr-claude-code', model: 'opus 5.5 medium', state: 'ready', line: 'I added a small cart module and three tests.' },
  { name: 'docs-site', icon: 'i-herdr-codex', model: 'gpt-5.5 medium', state: 'ready', line: 'The changelog for 2.4 is written. Anything else?' },
])
</script>

<template>
  <div ref="root" class="al" aria-hidden="true">
    <div class="brand"><PixelMark class="mark" :boot="false" :glow="false" /> WHERDR · HERDR 0.9.1</div>
    <div class="title">Agents</div>
    <DemoCounts :agents="agents" />
    <div class="list">
      <DemoAgentCard v-for="(a, i) in agents" :key="a.name" :agent="a" :active="i === 0 && step >= 1 && step < 5">
        <div v-if="i === 0 && step >= 1 && step < 3" class="opts demo-rise">
          <span v-for="o in OPTIONS" :key="o.n" class="opt" :class="{ hit: step >= 2 && o.n === PICKED }"><b>{{ o.n }}</b> {{ o.title }}</span>
        </div>
      </DemoAgentCard>
    </div>
  </div>
</template>

<style scoped>
.al {
  --u: calc(100cqw / 390);
  position: absolute; inset: 0; display: flex; flex-direction: column; gap: calc(var(--u) * 14);
  padding: calc(var(--u) * 14) calc(var(--u) * 16);
  background: var(--bg); color: var(--text); font: calc(var(--u) * 16) / 1.45 var(--sans); text-align: left; user-select: none;
}
.brand { display: flex; align-items: center; gap: calc(var(--u) * 10); font: 600 calc(var(--u) * 12) / 1 var(--mono); letter-spacing: .14em; color: var(--accent); }
.mark { width: calc(var(--u) * 28); height: auto; color: #fff; }
.title { font: 800 calc(var(--u) * 40) / 1 var(--display); color: #fff; letter-spacing: -.02em; }
.list { display: flex; flex-direction: column; gap: calc(var(--u) * 8); margin-top: calc(var(--u) * 6); }
.opts { display: flex; flex-wrap: wrap; gap: calc(var(--u) * 6); margin-top: calc(var(--u) * 10); }
.opt { padding: calc(var(--u) * 6) calc(var(--u) * 10); border: 1px solid var(--line-strong); background: var(--bg-2); font: calc(var(--u) * 13) / 1.2 var(--sans); transition: background .2s, box-shadow .2s; }
.opt b { font: 600 calc(var(--u) * 12) var(--mono); color: var(--rose); }
.opt.hit { background: color-mix(in srgb, var(--accent) 18%, var(--bg-2)); box-shadow: inset 0 0 0 1px var(--accent); }
.opt.hit b { color: var(--accent); }
</style>
