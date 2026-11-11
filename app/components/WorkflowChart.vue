<script setup lang="ts">
// A task type's workflow as a diagram, read only: each step a node with its
// column, who holds it (agent and model from the prefs), how it ends, its
// timeout and proofs, the guard where a merge happens, and one sentence
// (describeStep). The cards snake across rows (one column on a phone); an SVG
// layer behind them draws the arrows, coloured by who acts next, the send-back
// loops, and a square travelling the path. Above them, the type's route in one line.
import { planSteps, stepLabels, type PlannedStep } from '#shared/pm/steps'
import { taskGuards } from '#shared/pm/actions'
import { isProtected, mayMerge } from '#shared/pm/guards'
import { reviewerPlan, workerPlan, type Task } from '#shared/pm/run'
import { actionLabel, describeStep } from '#shared/pm/describe'
import { DEFAULT_ROUNDS } from '#shared/pm/steps'
import { isPrMerge, type Evidence, type Template } from '#shared/pm/workflow'

const props = defineProps<{ workflow: Template, type: string, base?: string, coordinator?: string }>()

type Kind = 'agent' | 'engine' | 'you' | 'edge'
const PROOF: Record<Evidence, string> = { 'link': 'Link', 'commit': 'Commit', 'report': 'Report', 'proposed-tasks': 'Proposed tasks', 'screenshots': 'Screenshots' }

const plan = computed(() => planSteps(props.workflow, { type: props.type }, props.base))
const guards = computed(() => taskGuards(props.workflow, props.type))
const agentOf = (r: { program: string, model: string } | { reason: string }) =>
  'reason' in r ? tl('not set') : `${kindLabel(r.program)} · ${r.model}`
const agents = computed(() => {
  const task = { type: props.type } as Task
  return { worker: agentOf(workerPlan(props.workflow, task)), reviewer: agentOf(reviewerPlan(props.workflow, task)) }
})

// Where a merge goes, for the guard line: the land's target, or the PR's base.
const intoOf = (steps: PlannedStep[], i: number) => {
  const a = steps[i]!.action
  if (a?.kind === 'git.land') return a.target
  if (isPrMerge(a?.kind)) return steps.slice(0, i).findLast(s => s.action?.kind === 'github.pr')?.action?.base
}

const nodes = computed(() => plan.value.map((s, i, all) => {
  const last = i === all.length - 1
  const kind: Kind = s.holder && s.holder !== 'none' ? 'agent' : s.ends === 'user' || s.guarded ? 'you' : s.ends === 'action' ? 'engine' : 'edge'
  const who = s.holder === 'worker' ? [tl('Worker'), agents.value.worker]
    : s.holder === 'reviewer' ? [tl('Reviewer'), agents.value.reviewer]
    : s.holder === 'coordinator' ? [tl('Coordinator'), props.coordinator ? kindLabel(props.coordinator) : '']
    : kind === 'you' ? [tl('You'), ''] : kind === 'engine' ? [tl('The engine'), ''] : [i === 0 ? tl('Start') : last ? tl('Finish') : tl('Pass-through'), '']
  const a = s.action
  const act = a ? actionLabel(a, tl) + (a.method ? ` · ${a.method}` : '') + (a.checks?.length ? ` · ${tl(`once ${a.checks.join(', ')} green`)}` : '') : ''
  const ends = s.ends === 'report' ? tl('Its report')
    : s.ends === 'verdict' ? tl('A verdict: pass or send back')
    : s.ends === 'user' ? tl(`Your button “${stepLabels(s).button}”`) + (act ? ` → ${act}` : '')
    : s.ends === 'action' ? act : ''
  const into = intoOf(all, i)
  // Two facts: is the branch protected, and may the engine merge into it.
  const merges = into && (a?.kind === 'git.land' || isPrMerge(a?.kind))
  const guard = merges ? tl(`${into} is ${isProtected(guards.value, into) ? 'protected' : 'not protected'}: ${mayMerge(guards.value, into, 'engine') ? 'the engine merges' : 'you merge'}`) : ''
  const facts = [
    ...(s.evidence ?? []).map(e => (e === 'screenshots' && s.screenshots === 'before-after' ? tl('Screenshots before and after') : tl(PROOF[e]))),
    ...(s.timeout ? [tl(`Timeout ${s.timeout}`)] : []),
    ...(s.recheck ? [tl(`Checks again every ${s.recheck}`)] : []),
  ]
  const loop = s.ends === 'verdict' ? tl(`Sends back to ${s.sendBack}, up to ${s.rounds ?? DEFAULT_ROUNDS} rounds, then you decide`) : ''
  // The step in a few words, for the route line; start and finish are left out.
  const proofs = (s.evidence ?? []).map(e => tl(PROOF[e]).toLowerCase())
  const short = s.holder === 'reviewer' && s.ends === 'verdict' ? tl(`Reviewer, up to ${s.rounds ?? DEFAULT_ROUNDS} rounds`)
    : kind === 'agent' ? who[0] + (proofs.length ? tl(`, with ${proofs.join(', ')}`) : '')
    : s.ends === 'user' ? tl(`You press “${stepLabels(s).button}”`)
    : kind === 'engine' || kind === 'you' ? (a ? actionLabel(a, tl) : '') : ''
  return { s, kind, who, ends, guard, facts, loop, short, say: describeStep(s, tl, { first: i === 0, last }) }
}))
// The send-back loops: from the verdict step (to) back to its sendBack step (from).
const loops = computed(() => plan.value.flatMap((s, to) => {
  const from = s.ends === 'verdict' ? plan.value.findIndex(p => p.id === s.sendBack) : -1
  return from >= 0 && from < to ? [{ from, to }] : []
}))
const LEGEND: [Kind | 'loop', string][] = [['agent', 'An agent works'], ['engine', 'The engine acts'], ['you', 'Waits for you'], ['loop', 'Sent back'], ['edge', 'Start or finish']]
const about = computed(() => props.workflow.taskTypes[props.type]?.instructions?.trim() ?? '')

// Layout: as many columns as the width allows, the rows snaking (the second
// one right to left), so each arrow goes to a neighbouring card.
const board = ref<HTMLElement>()
const width = ref(0)
const cols = computed(() => Math.min(width.value >= 760 ? 3 : width.value >= 520 ? 2 : 1, Math.max(nodes.value.length, 1)))
const rowOf = (i: number) => Math.floor(i / cols.value)
const cell = (i: number) => {
  const c = cols.value, r = rowOf(i), at = i % c
  return { gridRow: r + 1, gridColumn: (r % 2 ? c - 1 - at : at) + 1 }
}
// Room for a loop drawn above the first row, or along the right side.
const padTop = computed(() => cols.value > 1 && loops.value.some(l => rowOf(l.from) === 0 && rowOf(l.to) === 0))
const padSide = computed(() => loops.value.some(l => rowOf(l.to) - rowOf(l.from) > 1))

// The arrows, measured once the cards are laid out. They meet a card on its
// title line (side arrows) or the middle of its edge (arrows down).
const edges = ref<{ d: string, kind: Kind }[]>([])
const backs = ref<string[]>([])
const TITLE = 30
function draw() {
  const el = board.value
  if (!el) return
  const b = [...el.querySelectorAll<HTMLElement>('.wf-card')].map(c => ({ x: c.offsetLeft, y: c.offsetTop, w: c.offsetWidth, h: c.offsetHeight }))
  if (b.length !== nodes.value.length) return
  edges.value = b.slice(1).map((t, k) => {
    const f = b[k]!
    const d = Math.abs(f.y - t.y) < 2
      ? (t.x > f.x ? `M${f.x + f.w} ${f.y + TITLE}H${t.x - 3}` : `M${f.x} ${f.y + TITLE}H${t.x + t.w + 3}`)
      : `M${f.x + f.w / 2} ${f.y + f.h}V${t.y - 3}`
    return { d, kind: nodes.value[k + 1]!.kind }
  })
  backs.value = loops.value.map(({ from, to }, n) => {
    const v = b[to]!, t = b[from]!
    if (rowOf(to) - rowOf(from) > 1) { // along the right side
      const x = el.clientWidth - 8 - n * 8
      return `M${v.x + v.w} ${v.y + TITLE + 10}H${x}V${t.y + TITLE + 10}H${t.x + t.w + 3}`
    }
    const vx = v.x + v.w * 0.3, tx = t.x + t.w * 0.3
    if (rowOf(to) === rowOf(from)) { const y = Math.min(v.y, t.y) - 16 - n * 6; return `M${vx} ${v.y}V${y}H${tx}V${t.y - 3}` }
    const y = (t.y + t.h + v.y) / 2 + n * 6 // through the gap between the two rows
    return `M${vx} ${v.y}V${y}H${tx}V${t.y + t.h + 3}`
  })
}
// The path of the travelling square: every arrow, one after the other.
const trail = computed(() => edges.value.map(e => e.d).join(''))
let ro: ResizeObserver | undefined
onMounted(() => {
  if (!board.value || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => { width.value = board.value?.clientWidth ?? 0; draw() })
  ro.observe(board.value)
})
onBeforeUnmount(() => ro?.disconnect())
watch([nodes, cols], () => nextTick(draw))
const uid = useId()
const KINDS: Kind[] = ['agent', 'engine', 'you', 'edge']
</script>

<template>
  <div class="wf" data-testid="wf-diagram">
    <p v-if="nodes.length" class="wf-route" data-testid="wf-route">
      <template v-for="(n, i) in nodes.filter(x => x.short)" :key="n.s.id"><span v-if="i" class="wf-to" aria-hidden="true">→</span><span :class="`k-${n.kind}`">{{ n.short }}</span></template>
    </p>
    <p v-if="about" class="wf-about">{{ about }}</p>
    <ul class="wf-legend" :aria-label="tl('Legend')">
      <li v-for="[k, label] in LEGEND" :key="k" :class="`k-${k}`"><i aria-hidden="true" />{{ tl(label) }}</li>
    </ul>
    <div ref="board" class="wf-board" :class="{ 'pad-top': padTop, 'pad-side': padSide, 'one-col': cols === 1 }" :style="{ '--cols': cols }">
      <svg class="wf-lines" aria-hidden="true">
        <defs>
          <marker v-for="k in [...KINDS, 'loop']" :id="`${uid}-${k}`" :key="k" :class="`k-${k}`" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" /></marker>
        </defs>
        <path v-for="(e, i) in edges" :key="`e${i}`" :d="e.d" class="wf-edge" :class="`k-${e.kind}`" :marker-end="`url(#${uid}-${e.kind})`" />
        <path v-for="(l, n) in loops" :key="`b${n}`" :d="backs[n] || ''" class="wf-back k-loop" :marker-end="`url(#${uid}-loop)`" />
        <rect v-if="trail" class="wf-pulse" x="-4" y="-4" width="8" height="8"><animateMotion :dur="`${edges.length * 1.1}s`" repeatCount="indefinite" :path="trail" /></rect>
      </svg>
      <ol class="wf-steps">
        <li v-for="(n, i) in nodes" :key="n.s.id" class="wf-node" :class="`k-${n.kind}`" :data-step="n.s.id" data-testid="wf-node">
          <div class="wf-card" :style="cell(i)">
            <div class="wf-head">
              <span class="wf-n mono">{{ String(i + 1).padStart(2, '0') }}</span>
              <b class="mono">{{ n.s.id }}</b>
              <small class="mono-label">{{ n.s.column || n.s.id }}</small>
            </div>
            <p class="wf-who" data-testid="wf-who"><span class="mono-label">{{ n.who[0] }}</span><span v-if="n.who[1]" class="mono">{{ n.who[1] }}</span></p>
            <p v-if="n.ends" class="wf-ends" data-testid="wf-ends"><span class="mono-label">{{ tl('Ends') }}</span> {{ n.ends }}</p>
            <ul v-if="n.facts.length || n.guard || n.loop" class="wf-facts">
              <li v-for="f in n.facts" :key="f" class="mono-label">{{ f }}</li>
              <li v-if="n.guard" class="mono-label wf-guard" data-testid="wf-guard"><UIcon :name="n.s.guarded ? 'i-lucide-lock' : 'i-lucide-git-merge'" aria-hidden="true" />{{ n.guard }}</li>
              <li v-if="n.loop" class="mono-label wf-loop-fact" data-testid="wf-loop"><UIcon name="i-lucide-undo-2" aria-hidden="true" />{{ n.loop }}</li>
            </ul>
            <p class="wf-say">{{ n.say }}</p>
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.wf { display: grid; gap: 14px; min-width: 0; }
.k-agent { --k: var(--working); }
.k-engine { --k: var(--accent); }
.k-you { --k: var(--blocked); }
.k-edge { --k: var(--line-strong); }
.k-loop { --k: var(--rose); }

/* The route: the steps in one line, each in its colour. */
.wf-route { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin: 0; padding: 12px 14px; border: 1px solid var(--line); background: var(--bg-2); font-size: 15px; line-height: 1.4; }
.wf-route > span:not(.wf-to) { color: var(--text-strong); box-shadow: inset 0 -2px 0 var(--k); }
.wf-to { color: var(--dim); font-family: var(--font-mono); }
.wf-about { margin: 0; font-size: 14px; color: var(--text-2); }
.wf-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0; padding: 0; list-style: none; font: 11px/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.wf-legend li { display: flex; align-items: center; gap: 6px; }
.wf-legend i { width: 14px; height: 0; border-top: 2px solid var(--k); }
.wf-legend .k-loop i { border-top-style: dashed; }

/* The board: a grid of cards over the arrows' layer. */
.wf-board { position: relative; display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 44px 48px; min-width: 0; }
.wf-board.one-col { gap: 30px; }
.wf-board.pad-top { padding-top: 26px; }
.wf-board.pad-side { padding-right: 26px; }
.wf-steps, .wf-node { display: contents; }
.wf-lines { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 0; }
.wf-lines marker path { fill: var(--k); }
.wf-edge, .wf-back { fill: none; stroke: var(--k); stroke-width: 2; }
.wf-back { stroke-dasharray: 6 5; animation: wf-flow 1.2s linear infinite; }
.wf-pulse { fill: var(--accent); }
@keyframes wf-flow { to { stroke-dashoffset: -22; } }
@media (prefers-reduced-motion: reduce) { .wf-pulse { display: none; } .wf-back { animation: none; } }

.wf-card { position: relative; z-index: 1; min-width: 0; padding: 10px 14px 12px; border: 1px solid var(--line); border-top: 3px solid var(--k); background: var(--bg-2); display: flex; flex-direction: column; gap: 6px; }
/* Start and finish: compact, not stretched to their row's height. */
.k-edge .wf-card { align-self: start; }
.wf-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.wf-n { font-size: 11px; color: var(--k); }
.wf-head b { font-size: 15px; color: var(--text-strong); }
.wf-who { display: flex; flex-wrap: wrap; gap: 2px 10px; margin: 0; color: var(--k); }
.wf-who .mono { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
.wf-ends { margin: 0; font-size: 14px; color: var(--text-2); overflow-wrap: anywhere; }
.wf-ends .mono-label { margin-right: 4px; color: var(--muted); }
.wf-facts { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.wf-facts li { display: inline-flex; align-items: center; gap: 5px; padding: 2px 6px; border: 1px solid var(--line); font-size: 11px; overflow-wrap: anywhere; }
.wf-guard { color: var(--blocked); }
.k-engine .wf-guard { color: var(--accent); }
.wf-facts .wf-loop-fact { color: var(--rose); border-color: color-mix(in srgb, var(--rose) 50%, var(--line)); }
.wf-say { margin: auto 0 0; padding-top: 2px; font-size: 13px; line-height: 1.45; color: var(--muted); }
</style>
