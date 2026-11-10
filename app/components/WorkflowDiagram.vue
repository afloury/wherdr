<script setup lang="ts">
// A workflow drawn as a row of linked steps (Work → PR → Review → Merge), each
// with who holds it. The row wraps: never a horizontal scroll. With `compare`
// (the steps before a change), the steps that differ are marked.
import type { FlowStep } from '#shared/pm/flow'
import type { Holder } from '#shared/pm/workflow'

const props = defineProps<{ steps: FlowStep[], label?: string, compare?: FlowStep[] }>()
const HOLDER: Record<Holder, string> = { worker: 'Worker', reviewer: 'Reviewer', coordinator: 'Coordinator', none: 'No agent' }
const changed = (s: FlowStep) => !!props.compare && !props.compare.some(b => b.id === s.id && b.holder === s.holder)
</script>

<template>
  <figure class="wf-diagram" data-testid="workflow-diagram">
    <figcaption v-if="label" class="mono-label">{{ label }}</figcaption>
    <ol v-if="steps.length" class="wf-row">
      <li v-for="(s, i) in steps" :key="`${i}-${s.id}`" class="wf-step" :class="{ changed: changed(s) }" data-testid="workflow-diagram-step">
        <span v-if="i" class="wf-arrow" aria-hidden="true">→</span>
        <span class="wf-box"><b class="mono">{{ s.id }}</b><small>{{ tl(HOLDER[s.holder]) }}</small></span>
      </li>
    </ol>
    <p v-else class="muted">{{ tl('No steps yet.') }}</p>
  </figure>
</template>

<style scoped>
.wf-diagram { display: grid; gap: 6px; margin: 0; min-width: 0; }
.wf-diagram p { margin: 0; }
.wf-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 0; margin: 0; padding: 0; list-style: none; }
.wf-step { display: flex; align-items: center; min-width: 0; }
.wf-arrow { padding: 0 6px; color: var(--dim); font-family: var(--font-mono); }
.wf-box { display: grid; gap: 1px; min-width: 0; padding: 4px 8px; border: 1px solid var(--line); background: var(--bg); overflow-wrap: anywhere; }
.wf-box b { font-size: 13px; font-weight: 600; color: var(--text); }
.wf-box small { font-size: 12px; color: var(--muted); }
.wf-step.changed .wf-box { border-color: var(--accent); }
.wf-step.changed .wf-box small { color: var(--accent); }
</style>
