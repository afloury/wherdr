<script setup lang="ts">
// The hero's desktop: the same made-up session as PhoneDemo, on the
// same HERO clock, in wherdr's computer layout (components/demo/Desktop.vue):
// in the compact list on the left, the demo agent's line moves with its state
// and opens on its question and answers while it waits. Its field never has
// the focus: the user acts from the phone.
import { AGENT, HERO, OPTIONS, PICKED, QUESTION, SHOP, agentState } from '~/utils/heroDemo'
import type { DemoAgent } from '~/utils/demoScript'

const root = ref<HTMLElement | null>(null)
const { step, loop } = useDemoClock(HERO, root)
const state = computed(() => agentState(step.value))

const agents = computed<DemoAgent[]>(() => [
  { name: AGENT, agent: 'omp', model: 'GPT-5.5', effort: 'high', state: state.value, line: QUESTION },
  { name: 'docs-site', agent: 'codex', model: 'gpt-5.5', effort: 'medium', state: 'done', line: '' },
])
const choices = OPTIONS.map(o => o.title)
</script>

<template>
  <div ref="root" class="hero-desk" aria-hidden="true">
    <DemoDesktop :width="1000" :agents="agents" :project="SHOP" :active="AGENT" :choices-for="AGENT" :choices="choices" :hit="step >= 10 ? PICKED : undefined" where="~/projects/acme-api">
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
