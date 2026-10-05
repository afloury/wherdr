<script setup lang="ts">
// A made-up wherdr conversation that plays in a loop (~14 s) inside the hero
// phone, in the app's own look (Titanium theme, fonts, bubbles, omp console):
// a message is typed and queued, then sent; the agent works in its console
// (actions `❯` pile up under the gliding ring), answers in typewriter +
// encrypted text, and asks a question with numbered answers; one is picked,
// and it starts over. Sized in `--u` = one iPhone point (390 pt wide screen).
// Script and clock (HERO) are shared with DesktopDemo: both show the same moment.
import { STATE_LABEL } from '~/utils/demoScript'
import { AGENT, ANSWER, HERO, MESSAGE, OPTIONS, PICKED, PREVIOUS, QUESTION, actionsAt, agentState } from '~/utils/heroDemo'

const root = ref<HTMLElement | null>(null)
const { step, loop, typed } = useDemoClock(HERO, root)

const actions = computed(() => actionsAt(step.value))
const state = computed(() => agentState(step.value))
</script>

<template>
  <div ref="root" class="pd" aria-hidden="true">
    <header class="top">
      <UIcon name="i-lucide-chevron-left" class="ic" />
      <div class="who">
        <div class="name">{{ AGENT }}</div>
        <div class="state"><span :class="`demo-${state}`"><i class="demo-sq" />{{ STATE_LABEL[state] }}</span> <span class="demo-dim">· omp</span></div>
      </div>
      <div class="tools">
        <UIcon name="i-lucide-plus" class="ic" />
        <UIcon name="i-lucide-square-terminal" class="ic" />
        <UIcon name="i-lucide-search" class="ic" />
      </div>
    </header>

    <div class="body" :class="{ fade: step >= 11 }">
      <div class="old">
        <p>{{ PREVIOUS }}</p>
        <div class="meta"><UIcon name="i-lucide-copy" class="demo-mi" /> ✓ 1 min · 2 actions</div>
      </div>
      <DemoUserMessage v-if="step >= 2" :key="`u${loop}`" class="demo-rise" :text="MESSAGE" :meta="step < 3 ? 'Queued · sending…' : 'Sent · read by the agent'" :queued="step < 3" />
      <DemoConsole v-if="step >= 4" :key="`c${loop}`" class="demo-rise" :actions="actions" :running="step < 8" />
      <p v-if="step >= 8" :key="`a${loop}`" class="demo-rise"><EncryptedText :text="ANSWER" :duration="1700" /></p>
      <DemoTurnCard v-if="step >= 9" :key="`t${loop}`" class="demo-rise" edge :question="QUESTION" :options="OPTIONS" :picked="step >= 10 ? PICKED : undefined" />
    </div>

    <DemoComposer class="composer" :text="step === 1 ? typed : ''" :placeholder="step >= 9 ? 'Type a reply…' : 'Message to omp…'" model="GPT-5.5" effort="high" />
  </div>
</template>

<style scoped>
.pd {
  --u: calc(100cqw / 390);
  position: absolute; inset: 0; display: flex; flex-direction: column;
  background: var(--bg); color: var(--text); font: calc(var(--u) * 16) / 1.45 var(--sans);
  text-align: left; user-select: none;
}
.ic { width: calc(var(--u) * 24); height: calc(var(--u) * 24); color: var(--text); }

.top {
  display: flex; align-items: center; gap: calc(var(--u) * 12);
  height: calc(var(--u) * 58); padding: 0 calc(var(--u) * 16); flex: none;
  border-bottom: 1px solid var(--line);
}
.who { flex: 1; min-width: 0; }
.name { font: 700 calc(var(--u) * 19) / 1.1 var(--sans); color: #fff; }
.state { display: flex; align-items: center; gap: calc(var(--u) * 6); font: 500 calc(var(--u) * 13) / 1.4 var(--mono); }
.state > span:first-child { display: inline-flex; align-items: center; transition: color .3s; }
.tools { display: flex; gap: calc(var(--u) * 18); }

.body {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column; justify-content: flex-end; gap: calc(var(--u) * 14);
  padding: calc(var(--u) * 14) calc(var(--u) * 16);
  transition: opacity .6s ease;
}
.body.fade { opacity: 0; }
.body p { margin: 0; }
.old { color: var(--muted); }
.meta { margin-top: calc(var(--u) * 6); font: calc(var(--u) * 12) / 1.3 var(--mono); color: var(--dim); }
.composer { padding: calc(var(--u) * 8) calc(var(--u) * 12) calc(var(--u) * 26); }
</style>
