<script setup lang="ts">
// The coordinator window's content (CoordinatorButton; a project coordinator's only,
// Alfred has no autopilot): which agent answers it (its default changed in one
// gesture), a warning when its kept conversation ran with another agent,
// a line for the workflow change it proposed (reviewed in the project's sheet,
// ProposalReview), and its autopilot.
// On the board (`open`), also the button that opens or starts it.
import type { CoordinatorView } from '#shared/pm/coordinator'

const props = defineProps<{ c: CoordinatorView, open?: boolean }>()
const busy = ref(false)
const error = ref('')

// Its default: the one set for it, else the user's first agent (Settings › Agents).
const agent = computed(() => coordinatorAgent(props.c))
const agentName = (a?: { program: string }) => (a ? kindLabel(a.program) : '')
const pane = computed(() => coordinatorPane(props.c))
// The kept conversation is another agent's: warn, a new one first.
const other = computed(() => coordinatorMismatch(props.c))

async function act(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try { await fn(); await loadCoordinators() }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
const agentItems = computed(() => offerCoordinators(undefined, props.c.project).map(p => ({ label: kindLabel(p), value: p })))
const setDefault = (program: string) => act(() => api('/api/pm/coordinator-agent', { project: props.c.project, program }))
const fresh = () => act(async () => { const p = await launchCoordinator(props.c.project, agent.value); if (p) await navigateTo(panePath(p.id)) })
const resume = () => { resumeCoordinator(props.c.terminal!); if (props.open && pane.value) navigateTo(panePath(pane.value.id)) }
const openIt = () => (pane.value ? navigateTo(panePath(pane.value.id)) : fresh())
</script>

<template>
  <div class="coord" data-testid="coordinator-panel">
    <div class="coord-head">
      <div class="coord-field">
        <span class="field-label">{{ tl('Answering agent', 'Agent qui répond') }}</span>
        <USelect :model-value="agent?.program" :items="agentItems" size="lg" class="coord-agent w-full" :disabled="busy" :aria-label="tl('Default agent', 'Agent par défaut')" data-testid="coordinator-agent" @update:model-value="v => setDefault(String(v))" />
      </div>
      <UButton v-if="open && !other" color="primary" size="lg" :loading="busy" data-testid="coordinator-open" @click="openIt">
        {{ pane ? tl('Open', 'Ouvrir') : tl(`Start with ${agentName(agent)}`, `Lancer avec ${agentName(agent)}`) }}
      </UButton>
    </div>
    <div v-if="other && c.ran" class="term-banner coord-warn" data-testid="coordinator-other-agent">
      <UIcon name="i-lucide-triangle-alert" class="term-banner-icon" />
      <span class="coord-warn-text">{{ tl(`The previous conversation used ${agentName(c.ran)}. The default is ${agentName(agent)}.`, `La conversation précédente utilisait ${agentName(c.ran)}. Le défaut est ${agentName(agent)}.`) }}</span>
      <UButton size="xs" color="warning" :loading="busy" data-testid="coordinator-new" @click="fresh">{{ tl(`New conversation with ${agentName(agent)}`, `Nouvelle conversation avec ${agentName(agent)}`) }}</UButton>
      <UButton size="xs" color="warning" variant="outline" data-testid="coordinator-resume" @click="resume">{{ tl(`Resume with ${agentName(c.ran)}`, `Reprendre avec ${agentName(c.ran)}`) }}</UButton>
    </div>
    <div v-if="c.proposal" class="coord-actions" data-testid="template-proposal">
      <span class="mono-label">{{ tl('Workflow change proposed') }}</span>
      <UButton color="primary" size="lg" :to="proposalReviewPath(c.project)" data-testid="proposal-review-link">{{ tl('Review') }}</UButton>
    </div>
    <p v-if="error" class="error coord-error">{{ error }}</p>
    <CoordinatorAutopilot :c="c" />
  </div>
</template>

<style scoped>
.coord { display: grid; gap: 12px; }
.coord-head { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; }
.coord-head > * { flex: 1 1 160px; }
.coord-field { display: grid; gap: 4px; min-width: 0; }
.coord-warn { flex-wrap: wrap; }
.coord-warn-text { flex: 1 1 calc(100% - 40px); }
.coord-head :deep(.coord-agent) { min-width: 0; max-width: 100%; }
.coord-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.coord-actions .mono-label { flex: 1 1 100%; color: var(--muted); }
@media (min-width: 600px) { .coord-actions .mono-label { flex-basis: auto; } }
.coord-error { margin: 0; }
</style>
