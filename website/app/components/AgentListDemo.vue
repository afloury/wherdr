<script setup lang="ts">
// Story 1.2, right phone: wherdr's agent list (HomeView.vue). The
// agent that pushed its question shows the answers on its card; one tap
// answers without opening the conversation, the agent goes back to work, then
// is done (unread: green line, bold name). Same PHONE clock as NotifyDemo.
import { OPTIONS, PICKED, QUESTION } from '~/utils/heroDemo'
import { PHONE } from '~/utils/storyDemos'
import type { DemoAgent } from '~/utils/demoScript'

const root = ref<HTMLElement | null>(null)
const { step } = useDemoClock(PHONE, root)

const lead = computed<DemoAgent>(() => {
  const s = step.value
  const base = { name: 'acme-api', agent: 'omp', model: 'GPT-5.5', effort: 'high' } as const
  if (s >= 5) return { ...base, state: 'done', line: 'The cache keeps users for 5 minutes. 16 tests pass.' }
  if (s >= 4) return { ...base, state: 'working', line: '❯ edit src/users.js' }
  if (s >= 3) return { ...base, state: 'working', line: '5 minutes' }
  if (s >= 1) return { ...base, state: 'blocked', line: QUESTION }
  return { ...base, state: 'working', line: '❯ npm test' }
})
const agents = computed<DemoAgent[]>(() => [
  lead.value,
  { name: 'web-shop', agent: 'claude', model: 'Opus 5.5', effort: 'medium', state: 'idle', line: 'I added a small cart module and three tests.' },
  { name: 'docs-site', agent: 'codex', model: 'gpt-5.5', effort: 'medium', state: 'idle', line: 'The changelog for 2.4 is written. Anything else?' },
])
const choices = OPTIONS.map(o => o.title)
</script>

<template>
  <div ref="root" class="al app-ui" aria-hidden="true">
    <div class="home-top">
      <div class="eyebrow home-brand"><PixelMark class="home-logo" :boot="false" :glow="false" />wherdr · herdr 0.9.1</div>
      <div class="home-title-row">
        <h3 class="home-title">Agents</h3>
        <div class="home-actions">
          <span class="icon-btn"><UIcon name="i-lucide-search" /></span>
          <span class="icon-btn"><UIcon name="i-lucide-settings-2" /></span>
        </div>
      </div>
    </div>
    <div class="scroll">
      <div class="session-row"><span><UIcon name="i-lucide-layers" />devbox</span><b>default<UIcon name="i-lucide-chevron-right" /></b></div>
      <DemoCounts :agents="agents" />
      <div class="card-list">
        <DemoAgentCard
          v-for="(a, i) in agents" :key="a.name" :agent="a"
          :choices="i === 0 && step >= 1 && step < 3 ? choices : undefined" :hit="step >= 2 ? PICKED : undefined"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.al { --u: calc(100cqw / 390); position: absolute; inset: 0; display: flex; flex-direction: column; }
.home-top { display: flex; flex-direction: column; gap: calc(var(--u) * 10); padding: calc(var(--u) * 18) calc(var(--u) * 16) calc(var(--u) * 16); }
.scroll { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: calc(var(--u) * 14); padding: 0 calc(var(--u) * 16); }
.stats { margin-bottom: calc(var(--u) * 8); }
.home-top .home-title { font-size: calc(var(--u) * 34); }
</style>
