<script setup lang="ts">
// The task sheet's History tab: the hand-offs between worker, reviewer,
// wherdr, the coordinator and the user, oldest first (taskHistory). Each
// entry: who, when, what it is, then its text in Markdown (the chat's safe
// renderer), folded past a few lines. On top, the task's summary by a cheap
// model, when made (pmSummary.ts).
import type { Card } from '#shared/pm/board'
import { taskHistory, type Who } from '#shared/pm/history'

const props = defineProps<{ card: Card }>()
const WHO: Record<Who, string> = { worker: 'Worker', reviewer: 'Reviewer', user: 'You', coordinator: 'Coordinator', engine: 'wherdr' }
const summary = computed(() => (props.card.summary ? md(props.card.summary, { plain: true }) : ''))
const entries = computed(() => taskHistory(props.card.log, props.card.plan, props.card.state)
  .map(e => ({ ...e, html: md(e.text, { plain: true }), tone: e.label === 'Sent back' ? 'back' : e.label === 'Passed' ? 'pass' : '' })))
function onClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest?.('.code-copy') as HTMLElement | null
  const text = btn?.closest('.code-block')?.querySelector('pre')?.textContent
  if (btn && text != null) copyCodeBlock(btn, text)
}
</script>

<template>
  <section v-if="summary" class="task-summary" data-testid="task-summary">
    <span class="mono-label muted">{{ tl('Summary') }}</span>
    <!-- eslint-disable-next-line vue/no-v-html -- HTML sanitized by DOMPurify (utils/markdown.ts) -->
    <div class="md-body" v-html="summary" />
  </section>
  <ol class="task-history" data-testid="task-history">
    <li v-for="(e, i) in entries" :key="i" :class="e.tone" :data-who="e.who">
      <span class="mono-label">
        <b>{{ tl(WHO[e.who]) }}</b><template v-if="e.label"> · {{ tl(e.label) }}</template>
        <span class="muted"> · <time :datetime="new Date(e.at).toISOString()" :title="fmtDateTime(e.at)">{{ fmtWhen(new Date(e.at).toISOString()) }}</time><template v-if="e.agent"> · {{ e.agent }}</template></span>
      </span>
      <FoldText :lines="5">
        <!-- eslint-disable-next-line vue/no-v-html -- HTML sanitized by DOMPurify (utils/markdown.ts) -->
        <div class="md-body task-history-md" @click="onClick" v-html="e.html" />
      </FoldText>
    </li>
    <li v-if="!entries.length" class="muted">{{ tl('Nothing handed over yet.') }}</li>
  </ol>
</template>

<style scoped>
.task-summary { display: grid; gap: 4px; padding: 8px 12px; margin-bottom: 8px; border: 1px solid var(--line); background: var(--surface); color: var(--text-2); overflow-wrap: anywhere; }
.task-summary :deep(:is(p, ul, ol)) { margin: 0 0 .4em; }
.task-summary :deep(:last-child) { margin-bottom: 0; }
.task-history { list-style: none; margin: 0; padding: 0; }
.task-history li { display: grid; gap: 4px; min-width: 0; padding: 8px 0 8px 12px; border-bottom: 1px solid var(--line-soft); border-left: 2px solid var(--line); }
.task-history li.back { border-left-color: var(--blocked); }
.task-history li.pass { border-left-color: var(--done); }
.task-history li[data-who="user"] { border-left-color: var(--accent); }
.task-history-md { overflow-wrap: anywhere; color: var(--text-2); }
.task-history-md :deep(:is(h1, h2, h3, h4, h5, h6)) { font-size: 15px; margin: .6em 0 .3em; }
.task-history-md :deep(:is(p, ul, ol)) { margin: 0 0 .5em; }
.task-history-md :deep(:last-child) { margin-bottom: 0; }
</style>
