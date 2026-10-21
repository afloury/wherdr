<script setup lang="ts">
// Story 1.3: the herdr-projects 1.x Board on a computer (app/components/BoardView.vue),
// with the agent list collapsed to its rail. A task's agent finishes, its pull
// request passes review and the card moves to Ready to approve; its sheet
// (TaskSheet.vue) opens, Approve asks for a confirmation, and the task moves to
// Done. Then the Coordinator button opens the Coordinator in the side panel
// (BoardPanel.vue): a message becomes a new task, in To do, then Working. BOARD script.
import { BOARD, BOARD_GROUPS, COORD_ASK, COUPONS, boardAt } from '~/utils/storyDemos'

const root = ref<HTMLElement | null>(null)
const { step, loop, typed } = useDemoClock(BOARD, root)

const board = computed(() => boardAt(step.value))
const columns = computed(() => BOARD_GROUPS.map(g => ({ ...g, cards: board.value[g.id] })))
const sheet = computed(() => step.value >= 3 && step.value <= 5)
const confirm = computed(() => step.value === 4 || step.value === 5)
const panel = computed(() => step.value >= 7)
const coordinator = computed(() => (step.value === 9 ? 'working' : 'idle'))
// Rail counters (HomeView.vue rail-stats): the task agents and the Coordinator, by state.
const stats = computed(() => {
  const busy = coordinator.value === 'working' ? 1 : 0
  return [
    { s: 'blocked', n: board.value.needs.length },
    { s: 'working', n: board.value.working.length + busy },
    { s: 'done', n: board.value.ready.length + 1 - busy },
  ]
})
</script>

<template>
  <div ref="root" class="bd" aria-hidden="true">
    <div class="dd app-ui desk" :style="{ '--u': 'calc(100cqw / 1280)' }">
      <nav class="rail">
        <PixelMark class="home-logo" :boot="false" :glow="false" />
        <span class="icon-btn"><UIcon name="i-lucide-panel-left-open" /></span>
        <span class="icon-btn"><UIcon name="i-lucide-search" /></span>
        <span class="icon-btn"><UIcon name="i-lucide-plus" /></span>
        <span class="icon-btn on"><UIcon name="i-lucide-square-kanban" /></span>
        <span class="icon-btn"><UIcon name="i-lucide-settings-2" /></span>
        <ul class="rail-stats">
          <li v-for="c in stats" :key="c.s" class="rail-stat" :class="[c.s, { zero: !c.n }]"><b>{{ c.n }}</b><i /></li>
        </ul>
      </nav>

      <section class="bv">
        <header class="bv-top">
          <span class="icon-btn"><UIcon name="i-lucide-chevron-left" /></span>
          <h2 class="bv-title">Board</h2>
          <span class="bv-btn primary"><UIcon name="i-lucide-plus" />New task</span>
          <span class="bv-btn" :class="{ on: panel, hit: step === 7 }">Coordinator · devbox</span>
          <span class="bv-grow" />
          <span class="icon-btn"><UIcon name="i-lucide-refresh-cw" /></span>
        </header>
        <div class="bv-tools">
          <span class="bv-seg"><span class="on">Global</span><span>By repo</span></span>
          <span class="bv-seg"><span><UIcon name="i-lucide-archive" />Archived</span></span>
        </div>
        <div class="bv-grid">
          <div class="bv-head">
            <h3 v-for="col in columns" :key="col.id" class="bv-col-head" :class="col.id"><span>{{ col.label }}</span><span class="bv-count">{{ col.cards.length }}</span></h3>
          </div>
          <div class="bv-cols">
            <section v-for="col in columns" :key="col.id" class="bv-col">
              <div
                v-for="c in col.cards" :key="c.key" class="bd-card" :class="[col.id, { 'fresh demo-rise': c.fresh, hit: step === 3 && c.key === COUPONS.key && col.id === 'ready' }]"
              >
                <span class="bd-key">{{ c.key }}</span>
                <span class="bd-title">{{ c.title }}</span>
                <span v-if="c.msg" class="bd-note">{{ c.msg }}</span>
                <span v-if="c.app || c.pr || c.review" class="bd-chips">
                  <span v-if="c.app" class="bd-chip">{{ c.app }}</span>
                  <span v-if="c.progress !== undefined && col.id === 'working'" class="bd-chip">{{ c.progress }}%</span>
                  <span v-if="c.pr" class="bd-chip">{{ c.pr }}</span>
                  <span v-if="c.review" class="bd-chip" :class="c.review">review · {{ c.review }}</span>
                </span>
              </div>
              <p v-if="!col.cards.length" class="bd-empty">Nothing here</p>
            </section>
          </div>
        </div>

        <!-- The task's sheet, then Approve's confirmation (askConfirm). -->
        <div v-if="sheet" class="bd-scrim">
          <div class="bd-sheet demo-rise">
            <div class="bd-sheet-head"><h3>{{ COUPONS.title }}</h3><UIcon name="i-lucide-x" class="bd-sheet-x" /></div>
            <p class="bd-sheet-meta"><span class="bd-key">{{ COUPONS.key }}</span><span class="bd-state ready">Ready to approve</span><span class="bd-chip">codex</span></p>
            <p class="bd-sheet-msg">Ready for review</p>
            <dl class="bd-facts">
              <dt>Pull request</dt><dd class="link">{{ COUPONS.pr }} <UIcon name="i-lucide-external-link" /></dd>
              <dt>Review</dt><dd class="pass">Pass · 0 findings</dd>
              <dt>Branch</dt><dd class="mono">{{ COUPONS.branch }}</dd>
              <dt>Agent</dt><dd>codex</dd>
            </dl>
            <div class="bd-sheet-block"><h4>Description</h4><p>Customers enter a code at checkout; the discount shows in the cart total.</p></div>
            <div class="bd-actions">
              <span class="bd-act"><UIcon name="i-lucide-message-square" />Open the chat</span>
              <span class="bd-act primary" :class="{ hit: step === 4 }"><UIcon name="i-lucide-check" />Approve</span>
              <span class="bd-act end"><UIcon name="i-lucide-archive" />Archive</span>
            </div>
          </div>
          <div v-if="confirm" class="bd-confirm demo-rise">
            <p>Approve “{{ COUPONS.title }}”? herdr-projects merges its work. This cannot be undone.</p>
            <div class="bd-actions">
              <span class="bd-act">Cancel</span>
              <span class="bd-act primary" :class="{ hit: step === 5 }">Approve and merge</span>
            </div>
          </div>
        </div>
      </section>

      <!-- The Coordinator in the side panel (BoardPanel.vue). -->
      <aside v-if="panel" class="bp demo-rise">
        <header class="bp-head">
          <div class="bp-who">
            <p class="bp-path"><UIcon name="i-lucide-server" />devbox</p>
            <p class="bp-name"><UIcon name="i-lucide-message-square-text" class="bp-icon" />Coordinator</p>
            <p class="bp-purpose">All work: every repo and machine it can reach.</p>
          </div>
          <span class="icon-btn"><UIcon name="i-lucide-x" /></span>
        </header>
        <div class="bp-status"><DemoPill :state="coordinator" kind="claude" /></div>
        <div class="bp-chat">
          <DemoUserMessage v-if="step >= 9" :key="`u${loop}`" :text="COORD_ASK" :phase="step < 10 ? 'sent' : undefined" :time="step >= 10 ? '07:31' : undefined" />
          <DemoReply v-if="step >= 10" :key="`r${loop}`" :paras="['Added SHOP-16 · Gift cards at checkout in `web-shop` and put Claude on it. Its work is reviewed when it finishes, then waits for your approval on the Board.']" agent="claude" typing />
        </div>
        <DemoComposer agent="claude" desktop :focus="step >= 7 && step < 10" :text="step === 8 ? typed : ''" :stop="coordinator === 'working'" model="Opus 5.5" effort="high" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.bd { position: absolute; inset: 0; }
.dd { position: absolute; inset: 0; display: flex; }
/* The agent list, collapsed (main.css .home-rail). */
.rail { flex: none; width: calc(var(--u) * 64); display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 4); padding: calc(var(--u) * 20) 0; border-right: 1px solid var(--line); background: var(--bg); }
.rail .home-logo { margin-bottom: calc(var(--u) * 14); }
.icon-btn.on { color: var(--text); background: var(--surface-2); }
.rail-stats { list-style: none; margin: calc(var(--u) * 12) 0 0; padding: calc(var(--u) * 14) 0 0; width: 100%; border-top: 1px solid var(--line-soft); display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 14); }
.rail-stat { display: flex; flex-direction: column; align-items: center; gap: calc(var(--u) * 5); font: 700 calc(var(--u) * 13) / 1 var(--mono); color: var(--text); }
.rail-stat i { width: calc(var(--u) * 6); height: calc(var(--u) * 6); background: currentColor; }
.rail-stat.blocked i { background: var(--blocked); }
.rail-stat.blocked:not(.zero) b { color: var(--rose); }
.rail-stat.working i { background: var(--working); }
.rail-stat.done i { background: var(--done); }
.rail-stat.zero b { color: var(--dim); }

/* The Board (main.css .board-*). */
.bv { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
.bv-top { display: flex; align-items: center; gap: calc(var(--u) * 8); padding: calc(var(--u) * 14) calc(var(--u) * 16) calc(var(--u) * 10) calc(var(--u) * 8); border-bottom: 1px solid var(--line-soft); }
.bv-title { margin: 0 calc(var(--u) * 4) 0 0; font: 850 calc(var(--u) * 22) / 1 var(--display); letter-spacing: -.035em; color: var(--text); }
.bv-grow { flex: 1; }
.bv-btn { display: inline-flex; align-items: center; gap: calc(var(--u) * 6); height: calc(var(--u) * 34); padding: 0 calc(var(--u) * 12); border: 1px solid var(--line-strong); font: 600 calc(var(--u) * 10.5) / 1.1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--text-2); white-space: nowrap; transition: background .15s, box-shadow .15s; }
.bv-btn .iconify { width: calc(var(--u) * 14); height: calc(var(--u) * 14); }
.bv-btn.primary { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 55%, var(--line)); }
.bv-btn.on { background: var(--surface-2); color: var(--text); box-shadow: inset 0 0 0 1px var(--mauve); }
.bv-btn.hit { background: color-mix(in srgb, var(--mauve) 22%, transparent); }
.bv-tools { display: flex; justify-content: flex-end; gap: calc(var(--u) * 8); margin: calc(var(--u) * 10) calc(var(--u) * 24) 0; }
.bv-seg { display: flex; border: 1px solid var(--line); }
.bv-seg span { display: inline-flex; align-items: center; gap: calc(var(--u) * 5); height: calc(var(--u) * 30); padding: 0 calc(var(--u) * 10); font: 500 calc(var(--u) * 10) / 1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.bv-seg span + span { border-left: 1px solid var(--line); }
.bv-seg span.on { background: var(--surface-2); color: var(--text); box-shadow: inset 0 calc(var(--u) * 2) 0 var(--mauve); }
.bv-seg .iconify { width: calc(var(--u) * 12); height: calc(var(--u) * 12); }
.bv-grid { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 calc(var(--u) * 24); overflow: hidden; }
.bv-head, .bv-cols { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
.bv-head { margin-top: calc(var(--u) * 10); border-bottom: 1px solid var(--line); }
.bv-col-head { display: flex; align-items: center; gap: calc(var(--u) * 8); min-width: 0; margin: 0; padding: calc(var(--u) * 14) calc(var(--u) * 10) calc(var(--u) * 10); font: 600 calc(var(--u) * 11) / 1.2 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.bv-col-head + .bv-col-head { border-left: 1px solid var(--line-soft); }
.bv-col-head > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bv-col-head.needs { color: var(--rose); }
.bv-col-head.ready { color: var(--green); }
.bv-col-head.working { color: var(--working); }
.bv-col-head.todo { color: var(--lav); }
.bv-col-head.done { color: var(--done); }
.bv-count { flex: none; min-width: calc(var(--u) * 22); padding: calc(var(--u) * 3) calc(var(--u) * 5); border: 1px solid var(--line); font: 500 calc(var(--u) * 10.5) / 1 var(--mono); color: var(--muted); text-align: center; letter-spacing: 0; }
.bv-cols { flex: 1; }
.bv-col { position: relative; min-width: 0; display: flex; flex-direction: column; gap: calc(var(--u) * 8); padding: calc(var(--u) * 10); }
.bv-col + .bv-col { border-left: 1px solid var(--line-soft); }
.bd-empty { margin: 0; padding: calc(var(--u) * 6) calc(var(--u) * 2); font: calc(var(--u) * 11) / 1.4 var(--mono); color: var(--dim); }

/* A task (TaskCard.vue, main.css .board-card / .task-card). */
.bd-card { display: flex; flex-direction: column; align-items: flex-start; gap: calc(var(--u) * 6); min-width: 0; padding: calc(var(--u) * 10) calc(var(--u) * 12); border: 1px solid var(--line-soft); background: var(--surface); transition: background .3s, box-shadow .3s; }
.bd-card.needs { border-left: calc(var(--u) * 2) solid var(--rose); }
.bd-card.ready { border-left: calc(var(--u) * 2) solid var(--green); }
.bd-card.working { border-left: calc(var(--u) * 2) solid var(--working); }
.bd-card.todo { border-left: calc(var(--u) * 2) solid var(--line-strong); }
.bd-card.fresh { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mauve) 60%, transparent); }
.bd-card.hit { background: var(--surface-2); }
.bd-key { font: 600 calc(var(--u) * 10.5) / 1 var(--mono); letter-spacing: .08em; color: var(--text-3); }
.bd-title { max-width: 100%; font-weight: 500; font-size: calc(var(--u) * 13.5); line-height: 1.3; color: var(--text); overflow-wrap: anywhere; }
.bd-note { max-width: 100%; font: calc(var(--u) * 11) / 1.4 var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.bd-chips { display: flex; flex-wrap: wrap; gap: calc(var(--u) * 4); }
.bd-chip { padding: calc(var(--u) * 3) calc(var(--u) * 5); border: 1px solid var(--line); font: 500 calc(var(--u) * 9.5) / 1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); }
.bd-chip.pass { color: var(--green); border-color: color-mix(in srgb, var(--green) 45%, var(--line)); }
.bd-chip.fail { color: var(--rose); border-color: color-mix(in srgb, var(--rose) 45%, var(--line)); }

/* The task's sheet and the confirmation (TaskSheet.vue, main.css .task-sheet-*). */
.bd-scrim { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / .5); }
.bd-sheet, .bd-confirm { grid-area: 1 / 1; border: 1px solid var(--line); background: var(--bg-2); }
.bd-sheet { width: calc(var(--u) * 560); display: flex; flex-direction: column; gap: calc(var(--u) * 14); padding: calc(var(--u) * 22); }
.bd-sheet-head { display: flex; align-items: flex-start; gap: calc(var(--u) * 12); }
.bd-sheet-head h3 { flex: 1; margin: 0; font: 850 calc(var(--u) * 22) / 1.15 var(--display); letter-spacing: -.03em; color: var(--text); }
.bd-sheet-x { width: calc(var(--u) * 18); height: calc(var(--u) * 18); color: var(--text-2); }
.bd-sheet-meta { display: flex; align-items: center; gap: calc(var(--u) * 6); margin: 0; }
.bd-state { padding: calc(var(--u) * 3) calc(var(--u) * 6); border: 1px solid currentColor; font: 600 calc(var(--u) * 9.5) / 1 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
.bd-state.ready { color: var(--green); }
.bd-sheet-msg { margin: 0; font: calc(var(--u) * 12) / 1.45 var(--mono); color: var(--text-2); }
.bd-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: calc(var(--u) * 8) calc(var(--u) * 14); margin: 0; padding: calc(var(--u) * 12); border: 1px solid var(--line); }
.bd-facts dt { font: 500 calc(var(--u) * 10) / 1.5 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.bd-facts dd { display: flex; align-items: center; gap: calc(var(--u) * 4); margin: 0; min-width: 0; font-size: calc(var(--u) * 13.5); color: var(--text); }
.bd-facts dd.mono { font: calc(var(--u) * 12) / 1.5 var(--mono); }
.bd-facts dd.pass { color: var(--green); }
.bd-facts dd.link { color: var(--accent); }
.bd-facts .iconify { width: calc(var(--u) * 12); height: calc(var(--u) * 12); }
.bd-sheet-block h4 { margin: 0 0 calc(var(--u) * 6); font: 600 calc(var(--u) * 10.5) / 1.4 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.bd-sheet-block p { margin: 0; font-size: calc(var(--u) * 14); line-height: 1.55; color: var(--text-2); }
.bd-actions { display: flex; gap: calc(var(--u) * 8); }
.bd-act { display: inline-flex; align-items: center; gap: calc(var(--u) * 6); height: calc(var(--u) * 32); padding: 0 calc(var(--u) * 10); border: 1px solid var(--line-strong); font-size: calc(var(--u) * 13.5); color: var(--text); transition: background .15s, filter .15s; }
.bd-act .iconify { width: calc(var(--u) * 15); height: calc(var(--u) * 15); }
.bd-act.primary { border-color: var(--accent); background: var(--accent); color: var(--bg); }
.bd-act.primary.hit { filter: brightness(1.25); box-shadow: 0 0 0 calc(var(--u) * 3) color-mix(in srgb, var(--accent) 30%, transparent); }
.bd-act.end { margin-left: auto; border-color: transparent; }
.bd-confirm { width: calc(var(--u) * 420); display: flex; flex-direction: column; gap: calc(var(--u) * 16); padding: calc(var(--u) * 20); box-shadow: 0 calc(var(--u) * 24) calc(var(--u) * 48) rgb(0 0 0 / .45); }
.bd-confirm p { margin: 0; font-size: calc(var(--u) * 14.5); line-height: 1.5; color: var(--text); }
.bd-confirm .bd-actions { justify-content: flex-end; }

/* The side panel (BoardPanel.vue, main.css .board-panel-*). */
.bp { flex: none; width: calc(var(--u) * 440); display: flex; flex-direction: column; border-left: 1px solid var(--line); background: var(--bg); }
.bp-head { display: flex; align-items: flex-start; gap: calc(var(--u) * 8); padding: calc(var(--u) * 14) calc(var(--u) * 10) calc(var(--u) * 12) calc(var(--u) * 16); border-bottom: 1px solid var(--line-soft); }
.bp-who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: calc(var(--u) * 5); }
.bp-who p { margin: 0; }
.bp-path { display: flex; align-items: center; gap: calc(var(--u) * 5); font: 500 calc(var(--u) * 10.5) / 1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.bp-path .iconify { width: calc(var(--u) * 12); height: calc(var(--u) * 12); }
.bp-name { display: flex; align-items: center; gap: calc(var(--u) * 8); font: 700 calc(var(--u) * 16) / 1.2 var(--display); color: var(--text); }
.bp-icon { width: calc(var(--u) * 16); height: calc(var(--u) * 16); color: var(--mauve); }
.bp-purpose { font-size: calc(var(--u) * 12.5); line-height: 1.4; color: var(--text-3); }
.bp-status { padding: calc(var(--u) * 10) calc(var(--u) * 16); border-bottom: 1px solid var(--line-soft); }
.bp-chat { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; gap: calc(var(--u) * 6); padding: calc(var(--u) * 12) calc(var(--u) * 16) calc(var(--u) * 4); }
.bp :deep(.composer) { padding: 0 calc(var(--u) * 12) calc(var(--u) * 14); }
</style>
