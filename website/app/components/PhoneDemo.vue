<script setup lang="ts">
// A made-up wherdr conversation that plays in a loop (~14 s) inside the hero
// phone, drawn with the app's own pieces (components/demo, Titanium theme,
// default settings): a message is typed (field focused, ring and halo
// gliding) and queued, then sent; omp works in its console, answers in
// typewriter + encrypted text, and asks a question with numbered answers; one
// is picked, and it starts over. Sized in `--u` = one iPhone point (390 pt).
// Script and clock (HERO) are shared with DesktopDemo: both show the same moment.
import { AGENT, HERO, OPTIONS, PICKED, QUESTION, agentState } from '~/utils/heroDemo'

const root = ref<HTMLElement | null>(null)
const { step, loop, typed } = useDemoClock(HERO, root)
const state = computed(() => agentState(step.value))
</script>

<template>
  <div ref="root" class="pd app-ui" aria-hidden="true">
    <header class="agent-top">
      <span class="icon-btn"><UIcon name="i-lucide-chevron-left" /></span>
      <div class="agent-head">
        <div class="agent-title">{{ AGENT }}</div>
        <div class="agent-meta"><DemoPill :state="state" kind="omp" /><span class="where">~/projects/acme-api</span></div>
      </div>
      <div class="agent-actions">
        <span class="icon-btn"><UIcon name="i-lucide-plus" /></span>
        <span class="icon-btn"><UIcon name="i-lucide-square-terminal" /></span>
        <span class="icon-btn"><UIcon name="i-lucide-search" /></span>
        <span class="icon-btn"><UIcon name="i-lucide-ellipsis" /></span>
      </div>
    </header>
    <div class="body" :class="{ fade: step >= 11 }">
      <DemoHeroChat :step="step" :loop="loop" />
    </div>
    <DemoTurnCard v-if="step >= 9 && step < 11" :question="QUESTION" :options="OPTIONS" :picked="step >= 10 ? PICKED : undefined" />
    <DemoComposer
      agent="omp" :text="step === 1 ? typed : ''" :focus="step === 1" :stop="state === 'working'"
      :placeholder="state === 'blocked' ? 'Type a reply…' : undefined" model="GPT-5.5" effort="high"
    />
  </div>
</template>

<style scoped>
.pd { --u: calc(100cqw / 390); position: absolute; inset: 0; display: flex; flex-direction: column; }
.body {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column; justify-content: flex-end;
  padding: calc(var(--u) * 18) calc(var(--u) * 16) calc(var(--u) * 8);
  transition: opacity .6s ease;
}
.body.fade { opacity: 0; }
.pd > .composer { padding-bottom: calc(var(--u) * 26); }
</style>
