<script setup lang="ts">
// A 'Workflow change' card: what the coordinator proposes, before and after as
// diagrams, and Review (ProposalReview). In the project's Workflow tab (`review`
// emitted) and in the coordinator's conversation (a link to that tab).
import type { CoordinatorView } from '#shared/pm/coordinator'

defineProps<{ c: CoordinatorView, link?: boolean }>()
const emit = defineEmits<{ review: [] }>()
</script>

<template>
  <section v-if="c.proposal" class="settings-card wf-change" data-testid="workflow-change">
    <div class="wf-change-head">
      <span class="card-state blocked" aria-hidden="true"><i /></span>
      <PartHead part="workflow" :title="tl('Workflow change')" />
    </div>
    <p v-if="c.proposal.said" class="wf-change-said">{{ tl('After your message') }}: “{{ c.proposal.said }}”</p>
    <template v-if="c.proposal.flow">
      <WorkflowDiagram :steps="c.proposal.flow.before" :label="tl('Before')" />
      <WorkflowDiagram :steps="c.proposal.flow.after" :compare="c.proposal.flow.before" :label="tl('After')" />
    </template>
    <UButton v-if="link" color="primary" size="lg" class="wf-change-btn" :to="proposalReviewPath(c.project)" data-testid="proposal-review-link">{{ tl('Review') }}</UButton>
    <UButton v-else color="primary" size="lg" class="wf-change-btn" data-testid="workflow-proposal" @click="emit('review')">{{ tl('Review') }}</UButton>
  </section>
</template>

<style scoped>
.wf-change { display: grid; gap: 10px; padding-top: 12px; }
.wf-change p { margin: 0; overflow-wrap: anywhere; }
.wf-change-head { display: flex; align-items: flex-start; gap: 10px; color: var(--blocked); }
.wf-change-head .card-state { margin-top: 4px; }
.wf-change-btn { justify-self: start; }
</style>
