<script setup lang="ts">
// The coordinator's proposed workflow change, in its conversation after the
// message that made it: what changes in a line or two, Accept / Refuse and
// See all changes (ProposalReview). Once answered: the outcome, by whom, when.
import type { CoordinatorView } from '#shared/pm/coordinator'
import { changeSummary } from '#shared/pm/workflowChanges'

const props = defineProps<{ c: CoordinatorView }>()
const review = ref(false)
const { busy, error, answer } = useProposalAnswer(() => props.c.project)
const summary = computed(() => (props.c.proposal ? (props.c.proposal.changes ? changeSummary(props.c.proposal.changes) : []) : props.c.answered?.summary ?? []))
const outcome = computed(() => {
  const a = props.c.answered
  if (!a) return ''
  const what = a.outcome === 'accepted' ? tl('Accepted') : a.outcome === 'refused' ? tl('Refused') : tl('Refused: the workflow changed since')
  return `${what} ${a.by === 'user' || !a.by ? tl('by you') : `${tl('by')} ${a.by}`} · ${fmtDateTime(a.at)}`
})
</script>

<template>
  <div class="proposal-card" :class="{ answered: !c.proposal }" data-testid="proposal-card">
    <span class="mono-label muted">{{ tl('Workflow change proposed') }}</span>
    <p v-for="(l, i) in summary" :key="i" class="proposal-line">{{ l }}</p>
    <template v-if="c.proposal">
      <div class="proposal-actions">
        <UButton color="neutral" variant="ghost" size="lg" data-testid="proposal-see" @click="review = true">{{ tl('See all changes') }}</UButton>
        <span class="proposal-gap" />
        <UButton color="neutral" variant="outline" size="lg" :loading="busy === 'refuse'" :disabled="busy !== ''" data-testid="proposal-card-refuse" @click="answer(false)">{{ tl('Refuse') }}</UButton>
        <UButton color="primary" size="lg" :loading="busy === 'accept'" :disabled="busy !== ''" data-testid="proposal-card-accept" @click="answer(true)">{{ tl('Accept') }}</UButton>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ t(error) }}</p>
      <ProposalReview v-model:open="review" :c="c" />
    </template>
    <p v-else class="proposal-outcome" :class="c.answered?.outcome === 'accepted' ? 'ok' : 'no'" data-testid="proposal-outcome">{{ outcome }}</p>
  </div>
</template>

<style scoped>
.proposal-card { display: grid; gap: 6px; margin: 4px 0 12px; padding: 10px 12px; border: 1px solid var(--line); border-left: 3px solid var(--blocked); background: var(--surface); }
.proposal-card.answered { border-left-color: var(--line); }
.proposal-line { margin: 0; overflow-wrap: anywhere; }
.proposal-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 4px; }
.proposal-gap { flex: 1 1 0; }
.proposal-outcome { margin: 0; font: 12px/1.4 var(--font-mono); }
.proposal-outcome.ok { color: var(--green); }
.proposal-outcome.no { color: var(--muted); }
@media (max-width: 599px) { .proposal-actions > :not(.proposal-gap) { flex: 1 1 auto; } .proposal-gap { display: none; } }
</style>
