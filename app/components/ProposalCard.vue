<script setup lang="ts">
// The coordinator's proposed workflow change, in its conversation after the
// message that made it: titled 'Workflow change' with what a workflow is, what
// changes in one line, the steps before and after drawn, who proposed it and the
// user's request behind it (ProposalOrigin), Accept / Refuse and See all
// changes (ProposalReview). Once answered: the outcome, by whom, when.
// canGoto, goto: in the conversation, the link back to that request.
import type { CoordinatorView } from '#shared/pm/coordinator'
import { changeHeadline } from '#shared/pm/workflowChanges'

const props = defineProps<{ c: CoordinatorView, canGoto?: boolean }>()
const emit = defineEmits<{ goto: [] }>()
const review = ref(false)
const { busy, error, answer } = useProposalAnswer(() => props.c.project)
const summary = computed(() => (props.c.proposal ? [changeHeadline(props.c.proposal.changes ?? { all: [], types: [] })].filter(Boolean) : props.c.answered?.summary ?? []))
const outcome = computed(() => {
  const a = props.c.answered
  if (!a) return ''
  const what = a.outcome === 'accepted' ? tl('Accepted') : a.outcome === 'refused' ? tl('Refused') : tl('Refused: the workflow changed since')
  return `${what} ${a.by === 'user' || !a.by ? tl('by you') : `${tl('by')} ${a.by}`} · ${fmtDateTime(a.at)}`
})
</script>

<template>
  <div class="proposal-card" :class="{ answered: !c.proposal }" data-testid="proposal-card">
    <PartHead part="workflow" :title="tl('Workflow change')" />
    <p v-for="(l, i) in summary" :key="i" class="proposal-line" data-testid="proposal-headline">{{ l }}</p>
    <template v-if="c.proposal?.flow">
      <WorkflowDiagram :steps="c.proposal.flow.before" :label="tl(`Before · ${c.proposal.flow.type}`)" />
      <WorkflowDiagram :steps="c.proposal.flow.after" :compare="c.proposal.flow.before" :label="tl(`After · ${c.proposal.flow.type}`)" />
    </template>
    <template v-if="c.proposal">
      <ProposalOrigin :c="c" :can-goto="canGoto" @goto="emit('goto')" />
      <div class="proposal-actions">
        <UButton color="neutral" variant="ghost" size="lg" data-testid="proposal-see" @click="review = true">{{ tl('See all changes') }}</UButton>
        <span class="proposal-gap" />
        <UButton color="neutral" variant="outline" size="lg" :loading="busy === 'refuse'" :disabled="busy !== ''" data-testid="proposal-card-refuse" @click="answer(false)">{{ tl('Refuse') }}</UButton>
        <UButton color="primary" size="lg" :loading="busy === 'accept'" :disabled="busy !== ''" data-testid="proposal-card-accept" @click="answer(true)">{{ tl('Accept') }}</UButton>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ t(error) }}</p>
      <ProposalReview v-model:open="review" :c="c" :can-goto="canGoto" @goto="review = false; emit('goto')" />
    </template>
    <p v-else class="proposal-outcome" :class="c.answered?.outcome === 'accepted' ? 'ok' : 'no'" data-testid="proposal-outcome">{{ outcome }}</p>
  </div>
</template>

<style scoped>
.proposal-card { display: grid; gap: 6px; margin: 4px 0 12px; padding: 10px 12px; border: 1px solid var(--line); border-left: 3px solid var(--blocked); background: var(--surface); }
.proposal-card.answered { border-left-color: var(--line); }
.proposal-line { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.proposal-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 4px; }
.proposal-gap { flex: 1 1 0; }
.proposal-outcome { margin: 0; font: 12px/1.4 var(--font-mono); }
.proposal-outcome.ok { color: var(--green); }
.proposal-outcome.no { color: var(--muted); }
@media (max-width: 599px) { .proposal-actions > :not(.proposal-gap) { flex: 1 1 auto; } .proposal-gap { display: none; } }
</style>
