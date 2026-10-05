<script setup lang="ts">
// Story 1.2, left phone: the lock screen. wherdr's Web Push lands
// when the agent needs you (its question and options), then when it is done.
// Same PHONE clock as AgentListDemo, the phone next to it.
import { OPTIONS, QUESTION } from '~/utils/heroDemo'
import { PHONE } from '~/utils/storyDemos'

const root = ref<HTMLElement | null>(null)
const { step, loop } = useDemoClock(PHONE, root)
</script>

<template>
  <div ref="root" class="ls" aria-hidden="true">
    <div class="clock">
      <div class="date">Tuesday 9 June</div>
      <div class="time">9:41</div>
    </div>
    <div class="stack">
      <div v-if="step >= 5" :key="`d${loop}`" class="note demo-rise">
        <div class="nh"><span class="app"><PixelMark :boot="false" :glow="false" /></span><b>wherdr</b><span class="when">now</span></div>
        <div class="nt">acme-api is done</div>
        <div class="nb">The cache keeps users for 5 minutes. 16 tests pass.</div>
      </div>
      <div v-if="step >= 1" :key="`q${loop}`" class="note demo-rise" :class="{ older: step >= 5 }">
        <div class="nh"><span class="app"><PixelMark :boot="false" :glow="false" /></span><b>wherdr</b><span class="when">{{ step >= 5 ? '1 min ago' : 'now' }}</span></div>
        <div class="nt">acme-api needs you</div>
        <div class="nb">{{ QUESTION }}</div>
        <div class="nb opts">{{ OPTIONS.map(o => `${o.n}. ${o.title}`).join(' · ') }}</div>
      </div>
    </div>
    <div class="bottom"><span class="pill" /></div>
  </div>
</template>

<style scoped>
.ls {
  --u: calc(100cqw / 390);
  position: absolute; inset: 0; display: flex; flex-direction: column;
  background: radial-gradient(120% 70% at 30% 10%, #2a3a52, transparent 60%), radial-gradient(90% 60% at 80% 90%, #3a2a4a, transparent 60%), #0d1015;
  color: #fff; font: calc(var(--u) * 15) / 1.35 var(--sans); text-align: left; user-select: none;
}
.clock { padding-top: calc(var(--u) * 40); text-align: center; }
.date { font: 600 calc(var(--u) * 19) / 1.2 var(--sans); color: rgba(255, 255, 255, .85); }
.time { font: 700 calc(var(--u) * 92) / 1 var(--display); letter-spacing: -.02em; }
.stack { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: calc(var(--u) * 8); padding: 0 calc(var(--u) * 10) calc(var(--u) * 20); }
.note { padding: calc(var(--u) * 12) calc(var(--u) * 14); border-radius: calc(var(--u) * 20); background: rgba(40, 46, 58, .78); backdrop-filter: blur(20px); transition: opacity .4s; }
.note.older { opacity: .7; }
.nh { display: flex; align-items: center; gap: calc(var(--u) * 8); margin-bottom: calc(var(--u) * 4); font-size: calc(var(--u) * 13); color: rgba(255, 255, 255, .7); }
.nh b { font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.app { display: grid; place-items: center; width: calc(var(--u) * 22); height: calc(var(--u) * 22); border-radius: calc(var(--u) * 5); background: var(--bg); color: #fff; }
.app :deep(svg) { width: 75%; height: auto; }
.when { margin-left: auto; }
.nt { font-weight: 600; }
.nb { color: rgba(255, 255, 255, .88); }
.opts { margin-top: calc(var(--u) * 4); font: calc(var(--u) * 13) / 1.4 var(--mono); color: rgba(255, 255, 255, .7); }
.bottom { display: grid; place-items: center; height: calc(var(--u) * 30); }
.pill { width: calc(var(--u) * 134); height: calc(var(--u) * 5); border-radius: 3px; background: #fff; }
</style>
