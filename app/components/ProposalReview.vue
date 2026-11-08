<script setup lang="ts">
// The review of a project coordinator's proposed workflow change: the user's
// sentence it followed, the change as a person reads it (or the JSON diff),
// Refuse or Accept. An outdated proposal (the workflow changed since) is
// refused by the server: its reason shows here.
import type { CoordinatorView } from '#shared/pm/coordinator'

const props = defineProps<{ c: CoordinatorView }>()
const emit = defineEmits<{ answered: [accepted: boolean] }>()
const open = defineModel<boolean>('open', { default: false })
const { busy, error, answer } = useProposalAnswer(() => props.c.project, (accepted) => { open.value = false; emit('answered', accepted) })
const lines = computed(() => diffLines(props.c.proposal?.diff ?? ''))
// The readable view first; JSON when there is nothing else to show.
const VIEWS = ['readable', 'json'] as const
const view = ref<typeof VIEWS[number]>('readable')
// Nothing readable (a change the builder does not describe): the JSON diff only.
const changes = computed(() => { const c = props.c.proposal?.changes; return c && (c.all.length || c.types.length) ? c : undefined })
watch(open, (o) => { if (o) { error.value = ''; view.value = changes.value ? 'readable' : 'json' } })
</script>

<template>
  <AppSheet v-model:open="open" :title="tl('Workflow change proposed')" tall wide top hide-close>
    <div class="review" data-testid="proposal-review">
      <span class="mono-label muted">{{ tl(`Coordinator ${c.project}`) }}<template v-if="c.proposal"> · {{ new Date(c.proposal.at).toLocaleString() }}</template></span>
      <template v-if="c.proposal">
        <p v-if="c.proposal.said" class="review-said">{{ tl('After your message') }}: “{{ c.proposal.said }}”</p>
        <div v-if="changes" class="segmented review-tabs" role="tablist" :style="{ '--segment-count': VIEWS.length }">
          <button v-for="k in VIEWS" :key="k" type="button" role="tab" :class="{ on: view === k }" :aria-selected="view === k" :data-testid="`proposal-view-${k}`" @click="view = k">
            <span>{{ k === 'json' ? 'JSON' : tl('Readable') }}</span>
          </button>
        </div>
        <ProposalChanges v-if="changes && view === 'readable'" :changes="changes" />
        <pre v-else class="review-diff" data-testid="proposal-diff"><span v-for="(d, i) in lines" :key="i" :class="d.k">{{ d.l }}
</span></pre>
        <div class="review-actions">
          <UButton color="neutral" variant="outline" size="xl" :loading="busy === 'refuse'" :disabled="busy !== ''" data-testid="proposal-refuse" @click="answer(false)">{{ tl('Refuse') }}</UButton>
          <UButton color="primary" size="xl" :loading="busy === 'accept'" :disabled="busy !== ''" data-testid="proposal-accept" @click="answer(true)">{{ tl('Accept') }}</UButton>
        </div>
      </template>
      <p v-else-if="!error" class="muted settings-hint">{{ tl('This proposal was answered.') }}</p>
      <p v-if="error" class="form-error" role="alert">{{ t(error) }}</p>
    </div>
  </AppSheet>
</template>

<style scoped>
.review { display: grid; gap: 12px; }
.review-said { margin: 0; overflow-wrap: anywhere; }
.review-diff { margin: 0; max-height: 55vh; overflow: auto; padding: 8px; border: 1px solid var(--line); background: var(--bg); font: 12px/1.5 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.review-diff .add { color: var(--green); }
.review-diff .del { color: var(--rose); }
.review-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
</style>
