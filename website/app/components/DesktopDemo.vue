<script setup lang="ts">
// The hero's desktop: the same made-up session as PhoneDemo, on the
// same HERO clock, in wherdr's computer layout (components/demo/Desktop.vue):
// the agent list on the left follows the demo agent's state and last line.
// Its field never has the focus: the user acts from the phone.
import { ACTIONS, AGENT, ANSWER, HERO, MESSAGE, OPTIONS, PICKED, PREVIOUS, QUESTION, actionsAt, agentState } from '~/utils/heroDemo'
import type { DemoAgent } from '~/utils/demoScript'

const root = ref<HTMLElement | null>(null)
const { step, loop } = useDemoClock(HERO, root)
const state = computed(() => agentState(step.value))

// The demo agent's last line, as its card previews it.
const lastLine = computed(() => {
  const s = step.value
  if (s >= 9) return QUESTION
  if (s >= 8) return ANSWER.replaceAll('`', '')
  const a = actionsAt(s).at(-1)
  if (a) return `❯ ${a.cmd}`
  return s >= 2 ? MESSAGE : PREVIOUS
})

const agents = computed<DemoAgent[]>(() => [
  { name: AGENT, agent: 'omp', model: 'GPT-5.5', effort: 'high', state: state.value, line: lastLine.value },
  { name: 'web-shop', agent: 'claude', model: 'Opus 5.5', effort: 'medium', state: 'working', line: `❯ ${ACTIONS[3]!.cmd}` },
  { name: 'docs-site', agent: 'codex', model: 'gpt-5.5', effort: 'medium', state: 'done', line: 'The changelog for 2.4 is written. Anything else?' },
])
</script>

<template>
  <div ref="root" class="hero-desk" aria-hidden="true">
    <DemoDesktop :width="1000" :agents="agents" :active="AGENT" where="~/projects/acme-api">
      <div class="body" :class="{ fade: step >= 11 }"><DemoHeroChat :step="step" :loop="loop" /></div>
      <template #bottom>
        <DemoTurnCard v-if="step >= 9 && step < 11" :question="QUESTION" :options="OPTIONS" :picked="step >= 10 ? PICKED : undefined" />
        <DemoComposer
          agent="omp" desktop :stop="state === 'working'"
          :placeholder="state === 'blocked' ? 'Type a reply…' : undefined" model="GPT-5.5" effort="high"
        />
      </template>
    </DemoDesktop>
  </div>
</template>

<style scoped>
.hero-desk { position: absolute; inset: 0; }
.body { transition: opacity .6s ease; }
.body.fade { opacity: 0; }
</style>
