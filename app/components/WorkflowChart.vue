<script setup lang="ts">
// A task type's workflow as a diagram, read only: each step a node with its
// column, who holds it (agent and model from the prefs), how it ends, its
// timeout and proofs, the guard where a merge happens, and one sentence
// (describeStep). Coloured arrows: the path, the send-back loops, the steps
// that wait for the user, the ones the engine runs. A square travels the path.
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
  return { s, kind, who, ends, guard, facts, loop, say: describeStep(s, tl, { first: i === 0, last }) }
}))
// The send-back loops: from the verdict step back to its sendBack step, each in its own lane.
const loops = computed(() => plan.value.flatMap((s, to) => {
  const from = s.ends === 'verdict' ? plan.value.findIndex(p => p.id === s.sendBack) : -1
  return from >= 0 && from < to ? [{ from, to }] : []
}))
const LEGEND: [Kind | 'loop', string][] = [['agent', 'An agent works'], ['engine', 'The engine acts'], ['you', 'Waits for you'], ['loop', 'Sent back'], ['edge', 'Start or finish']]
</script>

<template>
  <div class="wf" data-testid="wf-diagram">
    <ul class="wf-legend" :aria-label="tl('Legend')">
      <li v-for="[k, label] in LEGEND" :key="k" :class="`k-${k}`"><i aria-hidden="true" />{{ tl(label) }}</li>
    </ul>
    <div class="wf-grid" :style="{ '--lanes': loops.length }">
      <ol class="wf-steps">
        <li v-for="(n, i) in nodes" :key="n.s.id" class="wf-node" :class="`k-${n.kind}`" :style="{ '--row': i + 1 }" :data-step="n.s.id" data-testid="wf-node">
          <span class="wf-rail" aria-hidden="true"><i /></span>
          <div class="wf-card">
            <div class="wf-head">
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
      <span class="wf-pulse" :style="{ gridRow: `1 / ${nodes.length + 1}` }" aria-hidden="true"><i /></span>
      <span v-for="(l, n) in loops" :key="n" class="wf-back" :style="{ gridRow: `${l.from + 1} / ${l.to + 1}`, gridColumn: 3 + n }" aria-hidden="true"><i /></span>
    </div>
  </div>
</template>

<style scoped>
.wf { display: grid; gap: 12px; min-width: 0; }
.wf-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0; padding: 0; list-style: none; font: 11px/1.4 var(--font-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
.wf-legend li { display: flex; align-items: center; gap: 6px; }
.wf-legend i { width: 14px; height: 0; border-top: 2px solid var(--k); }
.wf-legend .k-loop i { border-top-style: dashed; }
.k-agent { --k: var(--working); }
.k-engine { --k: var(--accent); }
.k-you { --k: var(--blocked); }
.k-edge { --k: var(--line-strong); }
.k-loop { --k: var(--rose); }

.wf-grid { display: grid; grid-template-columns: 28px minmax(0, 1fr) repeat(var(--lanes), 22px); position: relative; }
.wf-steps { display: contents; }
.wf-node { display: contents; }
/* The arrow into each step, in its colour, ending on the step's square. */
.wf-rail { grid-column: 1; grid-row: var(--row); position: relative; }
.wf-rail::before { content: ''; position: absolute; left: 13px; top: 0; height: 16px; border-left: 2px solid var(--k); }
.wf-rail::after { content: ''; position: absolute; left: 9px; top: 12px; border: 5px solid transparent; border-top-color: var(--k); }
.wf-node:first-child .wf-rail::before, .wf-node:first-child .wf-rail::after { display: none; }
.wf-rail i { position: absolute; left: 7px; top: 22px; width: 14px; height: 14px; border: 2px solid var(--k); background: var(--bg); }
.wf-node.k-agent .wf-rail i, .wf-node.k-you .wf-rail i, .wf-node.k-engine .wf-rail i { background: var(--k); }
.wf-rail { background: linear-gradient(var(--line), var(--line)) 13px 36px / 2px calc(100% - 36px) no-repeat; }
.wf-node:last-child .wf-rail { background: none; }
.wf-card { grid-column: 2; grid-row: var(--row); min-width: 0; margin: 0 0 14px 6px; padding: 10px 14px 12px; border: 1px solid var(--line); border-left: 3px solid var(--k); background: var(--bg-2); display: grid; gap: 6px; }
.wf-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.wf-head b { font-size: 15px; color: var(--text-strong); }
.wf-who { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; color: var(--k); }
.wf-who .mono { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
.wf-ends { margin: 0; font-size: 14px; color: var(--text-2); overflow-wrap: anywhere; }
.wf-ends .mono-label { margin-right: 4px; color: var(--muted); }
.wf-facts { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.wf-facts li { display: inline-flex; align-items: center; gap: 5px; padding: 2px 6px; border: 1px solid var(--line); font-size: 11px; overflow-wrap: anywhere; }
.wf-guard { color: var(--blocked); }
.k-engine .wf-guard { color: var(--accent); }
.wf-facts .wf-loop-fact { color: var(--rose); border-color: color-mix(in srgb, var(--rose) 50%, var(--line)); }
.wf-say { margin: 0; font-size: 13px; line-height: 1.45; color: var(--muted); }

/* The send-back loop: from the verdict step's square up to the step it sends back to. */
.wf-back { position: relative; --k: var(--rose); }
.wf-back i { position: absolute; inset: 29px 8px -29px 0; border: 2px dashed var(--k); border-left: 0; }
.wf-back i::before { content: ''; position: absolute; top: -6px; left: -2px; border: 5px solid transparent; border-right-color: var(--k); transform: translateX(-100%); }
.wf-back::after { content: ''; position: absolute; right: 5px; width: 6px; height: 6px; background: var(--k); animation: wf-up 2.4s linear infinite; }

/* A square travelling down the path, step after step. */
.wf-pulse { grid-column: 1; position: relative; pointer-events: none; }
.wf-pulse i { position: absolute; left: 10px; width: 8px; height: 8px; background: var(--accent); animation: wf-down 6s linear infinite; }
@keyframes wf-down { from { top: 22px; opacity: 1; } 92% { opacity: 1; } to { top: calc(100% - 20px); opacity: 0; } }
@keyframes wf-up { from { bottom: -26px; } to { bottom: calc(100% - 32px); } }
@media (prefers-reduced-motion: reduce) { .wf-pulse, .wf-back::after { display: none; } }
</style>
