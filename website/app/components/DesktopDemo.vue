<script setup lang="ts">
// The hero demo on a computer: the same session as PhoneDemo, on the same
// clock (HERO script). The message typed on the phone shows up here, the
// agent's state and last line change in the sidebar, the console, answer and
// "Your turn" card appear at the same moment.
import { ACTIONS, AGENT, ANSWER, HERO, MESSAGE, OPTIONS, PICKED, PREVIOUS, QUESTION, actionsAt, agentState } from '~/utils/heroDemo'
import type { DemoAgent } from '~/utils/demoScript'

const root = ref<HTMLElement | null>(null)
const { step, loop } = useDemoClock(HERO, root)

const actions = computed(() => actionsAt(step.value))
const state = computed(() => agentState(step.value))

// The demo agent's last line, as its sidebar card previews it.
const lastLine = computed(() => {
  const s = step.value
  if (s >= 9) return QUESTION
  if (s >= 8) return ANSWER
  const a = actions.value.at(-1)
  if (a) return `❯ ${a.tool} ${a.arg}`
  return s >= 2 ? `You: ${MESSAGE}` : PREVIOUS
})

const agents = computed<DemoAgent[]>(() => [
  { name: AGENT, icon: 'i-herdr-omp', model: 'GPT-5.5 high', state: state.value, line: lastLine.value },
  { name: 'web-shop', icon: 'i-herdr-claude-code', model: 'opus 5.5 medium', state: 'work', line: `❯ ${ACTIONS[3].tool} npm run build` },
  { name: 'docs-site', icon: 'i-herdr-codex', model: 'gpt-5.5 medium', state: 'ready', line: 'The changelog for 2.4 is written. Anything else?' },
])
</script>

<template>
  <div ref="root" class="hero-desk" aria-hidden="true">
    <DemoDesktop :width="1000" :agents="agents" :active="AGENT" :title="{ name: AGENT, state, sub: 'omp · ~/projects/acme-api' }">
      <div class="body" :class="{ fade: step >= 11 }">
        <div class="old">
          <p>{{ PREVIOUS }}</p>
          <div class="meta"><UIcon name="i-lucide-copy" class="demo-mi" /> ✓ 1 min · 2 actions</div>
        </div>
        <DemoUserMessage v-if="step >= 2" :key="`u${loop}`" class="demo-rise" :text="MESSAGE" :meta="step < 3 ? 'Queued · sending…' : 'Sent · read by the agent'" :queued="step < 3" />
        <DemoConsole v-if="step >= 4" :key="`c${loop}`" class="demo-rise" :actions="actions" :running="step < 8" />
        <p v-if="step >= 8" :key="`a${loop}`" class="demo-rise"><EncryptedText :text="ANSWER" :duration="1700" /></p>
        <DemoTurnCard v-if="step >= 9" :key="`t${loop}`" class="demo-rise" :question="QUESTION" :options="OPTIONS" :picked="step >= 10 ? PICKED : undefined" />
      </div>
      <DemoComposer desktop :placeholder="step >= 9 ? 'Type a reply…' : 'Message to omp…'" model="GPT-5.5" effort="high" />
    </DemoDesktop>
  </div>
</template>

<style scoped>
.hero-desk { position: absolute; inset: 0; }
.body {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column; justify-content: flex-end; gap: calc(var(--u) * 18);
  padding: calc(var(--u) * 20) 0;
  transition: opacity .6s ease;
}
.body.fade { opacity: 0; }
.body p { margin: 0; }
.old { color: var(--muted); }
.meta { margin-top: calc(var(--u) * 8); font: calc(var(--u) * 12) / 1.3 var(--mono); color: var(--dim); }
</style>
