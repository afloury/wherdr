<script setup lang="ts">
// Story 1.3 on /preview: a herdr-projects coordinator on a computer, with the
// project's TASKS.md board on the right. A thread reports progress and becomes
// ready for review, the coordinator merges it and the task moves to "To
// test"; the user answers the "To decide" question from the board, which
// messages the coordinator (wherdr never writes TASKS.md). PROJECT script.
import { DECISION, DECISION_REPLY, PROJECT, boardAt } from '~/utils/storyDemos'
import type { BoardItem } from '~/utils/storyDemos'
import type { DemoAgent } from '~/utils/demoScript'

const root = ref<HTMLElement | null>(null)
const { step, loop, typed } = useDemoClock(PROJECT, root)

const board = computed(() => boardAt(step.value))
const lists = computed<{ key: string, icon: string, label: string, items: BoardItem[] }[]>(() => [
  { key: 'test', icon: 'i-lucide-flask-conical', label: 'To test', items: board.value.test },
  { key: 'decide', icon: 'i-lucide-signpost', label: 'To decide', items: board.value.decide },
  { key: 'progress', icon: 'i-lucide-activity', label: 'In progress', items: board.value.progress },
  { key: 'backlog', icon: 'i-lucide-archive', label: 'Backlog', items: board.value.backlog },
])
const coordinator = computed(() => (step.value >= 3 && step.value < 4) || step.value === 7 ? 'work' : 'ready')
const agents = computed<DemoAgent[]>(() => [
  { name: 'checkout', tag: 'COORDINATOR', icon: 'i-herdr-claude-code', model: 'opus 5.5 high', state: coordinator.value, line: step.value >= 8 ? 'Noted: the best price wins, coupons never stack.' : 'Thread t-0001 · coupon codes is running in web-shop.' },
  ...(step.value >= 4 ? [] : [{ name: 'hp-checkout-t-0001-coupon-codes', tag: 'T-0001', icon: 'i-herdr-codex', model: 'gpt-5.5 high', state: step.value >= 2 ? 'ready' as const : 'work' as const, line: step.value >= 2 ? 'Coupons apply in cartTotal; 9 tests pass.' : 'I will add a coupons module and cover it with tests.' }]),
  { name: 'hp-checkout-t-0002-guest-checkout', tag: 'T-0002', icon: 'i-herdr-claude-code', model: 'opus 5.5 medium', state: 'work', line: 'Writing the guest checkout form.' },
])
</script>

<template>
  <div ref="root" class="pj" aria-hidden="true">
    <DemoDesktop :width="1200" :agents="agents" active="checkout" :title="{ name: 'checkout', state: coordinator, sub: 'claude · ~/projects/checkout' }">
      <div class="body">
        <DemoUserMessage text="Plan the coupon codes feature for the checkout and start a thread for it." meta="07:04" />
        <p>Thread <b>t-0001 · coupon codes</b> is running in <code>web-shop</code> (Codex). I will review its branch when it is done.</p>
        <template v-if="step >= 3">
          <p :key="`r${loop}`" class="demo-rise">t-0001 is ready for review. The diff is clean, merging it.</p>
          <DemoConsole :key="`c${loop}`" class="demo-rise" agent="claude" icon="i-herdr-claude-code" :actions="[{ tool: 'bash', arg: 'git merge --no-ff t-0001' }, { tool: 'bash', arg: 'npm test  ✓ 31 passed' }]" :running="step < 4" />
        </template>
        <DemoUserMessage v-if="step >= 7" :key="`d${loop}`" class="demo-rise" :text="DECISION_REPLY" meta="Sent · read by the agent" />
        <p v-if="step >= 8" :key="`n${loop}`" class="demo-rise">Noted: the best price wins, coupons never stack. I added it to the coupons thread.</p>
      </div>
      <DemoComposer desktop :text="step === 6 ? typed : ''" placeholder="Message to Claude…" model="Opus 5.5" effort="high" />
      <template #aside>
        <div class="phead"><span class="pk">Project</span> / <b>checkout</b></div>
        <section v-for="l in lists" :key="l.key" class="list">
          <div class="lhead"><UIcon :name="l.icon" class="demo-mi" /> {{ l.label }} <span class="n">{{ l.items.length }}</span></div>
          <div v-if="!l.items.length" class="empty">Nothing here</div>
          <template v-for="it in l.items" :key="it.title">
            <div v-if="it.state" class="thread" :class="{ 'demo-rise': it.state === 'ready' }">
              <div :class="`demo-${it.state}`" class="ts"><i class="demo-sq" />{{ it.state === 'ready' ? 'ready for review' : 'working' }}</div>
              <div class="tt">{{ it.title }}</div>
              <div class="tn">{{ it.note }}</div>
            </div>
            <div v-else class="item" :class="{ 'demo-rise': it.fresh }">
              <i class="demo-sq" :class="`b-${l.key}`" /><span>{{ it.title }}</span>
              <span v-if="it.title === DECISION" class="reply" :class="{ hit: step >= 5 }">↳ Reply</span>
            </div>
          </template>
        </section>
      </template>
    </DemoDesktop>
  </div>
</template>

<style scoped>
.pj { position: absolute; inset: 0; }
.body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; gap: calc(var(--u) * 16); padding: calc(var(--u) * 20) 0; }
.body p { margin: 0; }
.body b { color: #fff; }
code { padding: 0 calc(var(--u) * 5); border-left: 1px solid var(--line-strong); background: var(--surface); font: calc(var(--u) * 14) var(--mono); color: var(--accent); }

.phead { display: flex; align-items: center; gap: calc(var(--u) * 8); height: calc(var(--u) * 54); padding: 0 calc(var(--u) * 16); border-bottom: 1px solid var(--line); color: var(--dim); }
.pk { font: 600 calc(var(--u) * 12) / 1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
.phead b { font-size: calc(var(--u) * 17); color: #fff; }
.list { padding: calc(var(--u) * 12) calc(var(--u) * 16); border-bottom: 1px solid var(--line); }
.lhead { display: flex; align-items: center; gap: calc(var(--u) * 8); margin-bottom: calc(var(--u) * 6); font: 600 calc(var(--u) * 12) / 1.6 var(--mono); letter-spacing: .14em; text-transform: uppercase; }
.n { margin-left: auto; padding: 0 calc(var(--u) * 6); border: 1px solid var(--line-strong); font-size: calc(var(--u) * 11); letter-spacing: 0; color: var(--muted); }
.empty { font: calc(var(--u) * 12) / 2 var(--mono); color: var(--dim); }
.item { display: flex; align-items: center; padding: calc(var(--u) * 6) 0; font-size: calc(var(--u) * 15); }
.b-test { color: var(--amber); }
.b-decide { color: var(--rose); }
.b-backlog { color: var(--dim); }
.reply { margin-left: auto; padding: calc(var(--u) * 3) calc(var(--u) * 8); border: 1px solid var(--line-strong); font: 600 calc(var(--u) * 11) / 1.4 var(--mono); color: var(--muted); white-space: nowrap; transition: background .2s, color .2s; }
.reply.hit { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.thread { margin: calc(var(--u) * 6) 0; padding: calc(var(--u) * 10) calc(var(--u) * 12); background: var(--surface); }
.ts { display: flex; align-items: center; font: 500 calc(var(--u) * 12) / 1.5 var(--mono); }
.tt { font-size: calc(var(--u) * 15); color: #fff; }
.tn { font: calc(var(--u) * 12) / 1.6 var(--mono); color: var(--dim); }
</style>
