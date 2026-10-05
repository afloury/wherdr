<script setup lang="ts">
// Story 1.3 on /preview: a herdr-projects coordinator on a computer, with the
// project's TASKS.md board on the right (ProjectPanel.vue). A thread reports
// progress and becomes ready for review, the coordinator merges it and the
// task moves to "To test"; the user answers the "To decide" question from the
// board: its Reply button fills the field with the decision prefix, the user
// types the answer and sends it (wherdr never writes TASKS.md). PROJECT script.
import { DECISION, DECISION_ANSWER, DECISION_PREFIX, PROJECT, boardAt } from '~/utils/storyDemos'
import type { BoardItem } from '~/utils/storyDemos'
import type { DemoAgent } from '~/utils/demoScript'

const root = ref<HTMLElement | null>(null)
const { step, loop, typed } = useDemoClock(PROJECT, root)

const board = computed(() => boardAt(step.value))
// Sections with the app's kinds and icons (ProjectPanel.vue ICONS).
const lists = computed<{ kind: string, icon: string, label: string, items: BoardItem[] }[]>(() => [
  { kind: 'test', icon: 'i-lucide-flask-conical', label: 'To test', items: board.value.test },
  { kind: 'decide', icon: 'i-lucide-signpost', label: 'To decide', items: board.value.decide },
  { kind: 'doing', icon: 'i-lucide-activity', label: 'In progress', items: board.value.progress },
  { kind: 'backlog', icon: 'i-lucide-archive', label: 'Backlog', items: board.value.backlog },
])
const coordinator = computed(() => (step.value === 3 || step.value === 7 ? 'working' : 'idle'))
const field = computed(() => (step.value === 5 ? DECISION_PREFIX : step.value === 6 ? DECISION_PREFIX + typed.value : ''))
const agents = computed<DemoAgent[]>(() => [
  { name: 'checkout', tag: 'Coordinator', agent: 'claude', model: 'Opus 5.5', effort: 'high', state: coordinator.value, where: '~/.herdr-projects/checkout', line: step.value >= 8 ? 'Noted: the best price wins, coupons never stack.' : 'Thread t-0001 · coupon codes is running in web-shop (Codex).' },
  ...(step.value >= 4 ? [] : [{ name: 'hp-checkout-t-0001-coupon-codes', tag: 'T-0001', agent: 'codex' as const, model: 'gpt-5.5', effort: 'high', state: step.value >= 2 ? 'done' as const : 'working' as const, line: step.value >= 2 ? 'Coupons apply in cartTotal; 9 tests pass.' : 'I will add a coupons module and cover it with tests.' }]),
  { name: 'hp-checkout-t-0002-guest-checkout', tag: 'T-0002', agent: 'claude', model: 'Opus 5.5', effort: 'medium', state: 'working', line: 'Writing the guest checkout form.' },
])
const toolUi = { root: 'tool', trigger: 'tool-trigger', label: 'tool-label', suffix: 'tool-suffix', leading: 'tool-leading' }
</script>

<template>
  <div ref="root" class="pj" aria-hidden="true">
    <DemoDesktop :width="1200" :agents="agents" active="checkout" where="~/.herdr-projects/checkout">
      <div class="chat-list">
        <DemoUserMessage text="Plan the coupon codes feature for the checkout and start a thread for it." time="07:04" />
        <div class="msg-who claude"><UIcon name="i-herdr-claude-code" /><span>claude</span></div>
        <DemoReply :paras="['Thread t-0001 · coupon codes is running in `web-shop` (Codex). I will review its branch when it is done.']" agent="claude" />
        <DemoTurnEnd text="✓ 20 s" />
        <template v-if="step >= 3">
          <DemoReply :key="`r${loop}`" :paras="['t-0001 is ready for review. The diff is clean, merging it.']" agent="claude" typing />
          <div :key="`t${loop}`" class="tools" :class="{ live: step < 4 }">
            <UChatTool text="Command" suffix="git merge --no-ff t-0001" icon="i-lucide-terminal" :ui="toolUi" />
            <UChatTool text="Command" suffix="npm test" icon="i-lucide-terminal" :loading="step < 4" :streaming="step < 4" :ui="toolUi" />
          </div>
        </template>
        <DemoUserMessage v-if="step >= 7" :key="`d${loop}`" :text="DECISION_PREFIX + DECISION_ANSWER" :phase="step < 8 ? 'sent' : undefined" :time="step >= 8 ? '07:31' : undefined" />
        <DemoReply v-if="step >= 8" :key="`n${loop}`" :paras="['Noted: the best price wins, coupons never stack. I added it to the coupons thread.']" agent="claude" typing />
      </div>
      <template #bottom>
        <DemoComposer agent="claude" desktop focus :text="field" :stop="coordinator === 'working'" model="Opus 5.5" effort="high" />
      </template>
      <template #aside>
        <div class="pp-head"><span class="pp-kicker">Project</span><span class="pp-slug">checkout</span><span class="pp-grow" /><span class="icon-btn pp-btn"><UIcon name="i-lucide-refresh-cw" /></span></div>
        <section v-for="l in lists" :key="l.kind" class="pp-sec" :class="l.kind">
          <div class="pp-sec-head"><UIcon :name="l.icon" class="pp-sec-icon" /><span class="pp-sec-title">{{ l.label }}</span><span class="pp-count">{{ l.items.length }}</span><UIcon name="i-lucide-chevron-down" class="pp-chev" /></div>
          <div class="pp-list">
            <div v-for="it in l.items" :key="it.title" class="pp-row" :class="{ 'pp-task': !it.state }">
              <div v-if="it.state" class="pp-card">
                <div class="pp-thread">
                  <DemoPill :state="it.state === 'ready' ? 'done' : 'working'" :label="it.state === 'ready' ? 'ready for review' : 'working'" />
                  <span class="pp-thread-title">{{ it.title }}</span>
                  <span class="pp-meta">{{ it.note }}</span>
                </div>
              </div>
              <template v-else>
                <span class="pp-box" /><span class="pp-task-text">{{ it.title }}</span>
                <span v-if="it.title === DECISION" class="pp-vbtn decide" :class="{ hit: step === 5 }"><UIcon name="i-lucide-reply" /></span>
              </template>
            </div>
          </div>
        </section>
      </template>
    </DemoDesktop>
  </div>
</template>

<style scoped>
.pj { position: absolute; inset: 0; }
/* Project panel (app main.css .pp-*). */
.pp-head { display: flex; align-items: center; gap: calc(var(--u) * 8); padding: calc(var(--u) * 8) calc(var(--u) * 8) calc(var(--u) * 8) calc(var(--u) * 16); border-bottom: 1px solid var(--line-soft); }
.pp-kicker { font: 600 calc(var(--u) * 10.5) / 1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--mauve); }
.pp-slug { font: 700 calc(var(--u) * 15) / 1.2 var(--display); color: var(--text); white-space: nowrap; }
.pp-slug::before { content: '/'; color: var(--dim); margin-right: calc(var(--u) * 8); font-family: var(--mono); font-weight: 400; }
.pp-grow { flex: 1; }
.pp-btn { width: calc(var(--u) * 32); height: calc(var(--u) * 32); }
.pp-sec { border-bottom: 1px solid var(--line-soft); }
.pp-sec-head { display: flex; align-items: center; gap: calc(var(--u) * 9); padding: calc(var(--u) * 14) calc(var(--u) * 14) calc(var(--u) * 10) calc(var(--u) * 16); color: var(--text-2); }
.pp-sec-icon { width: calc(var(--u) * 14); height: calc(var(--u) * 14); flex: none; color: var(--muted); }
.test .pp-sec-icon { color: var(--ochre); }
.decide .pp-sec-icon { color: var(--rose); }
.doing .pp-sec-icon { color: var(--working); }
.pp-sec-title { flex: 1; min-width: 0; font: 600 calc(var(--u) * 11) / 1.2 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.pp-count { flex: none; min-width: calc(var(--u) * 22); padding: calc(var(--u) * 3) calc(var(--u) * 5); border: 1px solid var(--line); font: 500 calc(var(--u) * 10.5) / 1 var(--mono); color: var(--muted); text-align: center; }
.pp-chev { width: calc(var(--u) * 14); height: calc(var(--u) * 14); flex: none; color: var(--dim); }
.pp-list { padding: 0 0 calc(var(--u) * 12); }
.pp-row { display: flex; align-items: flex-start; gap: calc(var(--u) * 8); padding: 0 calc(var(--u) * 12) 0 calc(var(--u) * 16); }
.pp-task { gap: calc(var(--u) * 10); padding-top: calc(var(--u) * 6); padding-bottom: calc(var(--u) * 6); font-size: calc(var(--u) * 13.5); line-height: 1.4; color: var(--text); }
.pp-box { flex: none; width: calc(var(--u) * 6); height: calc(var(--u) * 6); margin: calc(var(--u) * 7) calc(var(--u) * 3) 0 calc(var(--u) * 4); background: var(--dim); }
.test .pp-box { background: var(--ochre); }
.decide .pp-box { background: var(--rose); }
.pp-task-text { flex: 1; min-width: 0; }
.pp-vbtn { position: relative; flex: none; display: grid; place-items: center; width: calc(var(--u) * 26); height: calc(var(--u) * 26); border: 1px solid currentColor; background: color-mix(in srgb, currentColor 11%, transparent); color: var(--rose); transition: background .15s; }
.pp-vbtn.hit { background: color-mix(in srgb, currentColor 22%, transparent); }
.pp-vbtn .iconify { width: calc(var(--u) * 14); height: calc(var(--u) * 14); }
.pp-card { flex: 1; min-width: 0; margin: calc(var(--u) * 3) 0; border: 1px solid var(--line-soft); background: var(--surface); }
.pp-thread { display: flex; flex-direction: column; align-items: flex-start; gap: calc(var(--u) * 5); padding: calc(var(--u) * 9) calc(var(--u) * 10); }
.pp-thread .pill { font-size: calc(var(--u) * 10.5); }
.pp-thread-title { font-size: calc(var(--u) * 13.5); font-weight: 500; line-height: 1.35; color: var(--text); }
.pp-meta { max-width: 100%; font: 400 calc(var(--u) * 10.5) / 1.35 var(--mono); color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
