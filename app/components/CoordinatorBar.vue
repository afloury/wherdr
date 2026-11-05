<script setup lang="ts">
// A project coordinator: who you talk to and which agent answers (its default
// changed in one gesture), a warning when its kept conversation ran with
// another agent, and the template change it proposed, to accept or refuse.
// On the board (`open`), also the button that opens or starts it.
import { COORDINATOR_AGENTS, agentName, sameAgent, type CoordinatorAgent, type CoordinatorView } from '#shared/pm/coordinator'

const props = defineProps<{ c: CoordinatorView, open?: boolean }>()
const busy = ref(false)
const error = ref('')

const key = (a: CoordinatorAgent) => `${a.program}:${a.model}`
const choices = computed(() => [...COORDINATOR_AGENTS, ...[props.c.agent, props.c.ran].filter(a => a && !COORDINATOR_AGENTS.some(b => sameAgent(a, b))) as CoordinatorAgent[]])
const pane = computed(() => coordinatorPane(props.c))
// The kept conversation is another agent's: warn, a new one first.
const other = computed(() => !!pane.value && !!props.c.ran && !sameAgent(props.c.ran, props.c.agent) && !resumedCoordinators.value.includes(props.c.terminal!))
const diff = computed(() => (props.c.proposal?.diff ?? '').split('\n').map(l => ({ l, k: l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : '' })))

async function act(fn: () => Promise<unknown>) {
  busy.value = true
  error.value = ''
  try { await fn(); await loadCoordinators() }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
const setDefault = (v: string) => act(() => api('/api/pm/coordinator-agent', { project: props.c.project, ...choices.value.find(a => key(a) === v)! }))
const fresh = () => act(async () => { const p = await launchCoordinator(props.c.project); if (p) await navigateTo(panePath(p.id)) })
const resume = () => { resumedCoordinators.value = [...resumedCoordinators.value, props.c.terminal!]; if (props.open && pane.value) navigateTo(panePath(pane.value.id)) }
const openIt = () => (pane.value ? navigateTo(panePath(pane.value.id)) : fresh())
const answer = (accept: boolean) => act(() => api('/api/pm/template-proposal', { project: props.c.project, accept }))
</script>

<template>
  <div class="coord" data-testid="coordinator-bar">
    <div class="coord-head">
      <span class="mono-label">{{ tl('Project coordinator', 'Coordinateur de projet') }} · {{ c.project }}</span>
      <select class="pm-select coord-agent" :value="key(c.agent)" :disabled="busy" :aria-label="tl('Default agent', 'Agent par défaut')" data-testid="coordinator-agent" @change="setDefault(($event.target as HTMLSelectElement).value)">
        <option v-for="a in choices" :key="key(a)" :value="key(a)">{{ agentName(a) }}</option>
      </select>
      <UButton v-if="open && !other" color="primary" size="lg" :loading="busy" data-testid="coordinator-open" @click="openIt">
        {{ pane ? tl('Open', 'Ouvrir') : tl(`Start with ${agentName(c.agent)}`, `Lancer avec ${agentName(c.agent)}`) }}
      </UButton>
    </div>
    <div v-if="other && c.ran" class="term-banner coord-warn" data-testid="coordinator-other-agent">
      <UIcon name="i-lucide-triangle-alert" class="term-banner-icon" />
      <span class="coord-warn-text">{{ tl(`The previous conversation used ${agentName(c.ran)}. The default is ${agentName(c.agent)}.`, `La conversation précédente utilisait ${agentName(c.ran)}. Le défaut est ${agentName(c.agent)}.`) }}</span>
      <UButton size="xs" color="warning" :loading="busy" data-testid="coordinator-new" @click="fresh">{{ tl(`New conversation with ${agentName(c.agent)}`, `Nouvelle conversation avec ${agentName(c.agent)}`) }}</UButton>
      <UButton size="xs" color="warning" variant="outline" data-testid="coordinator-resume" @click="resume">{{ tl(`Resume with ${agentName(c.ran)}`, `Reprendre avec ${agentName(c.ran)}`) }}</UButton>
    </div>
    <section v-if="c.proposal" class="coord-proposal" data-testid="template-proposal">
      <span class="mono-label">{{ tl('Template change proposed', 'Changement de modèle proposé') }}</span>
      <p v-if="c.proposal.said" class="muted">{{ tl('After your message', 'Après ton message') }}: “{{ c.proposal.said }}”</p>
      <pre class="coord-diff"><span v-for="(d, i) in diff" :key="i" :class="d.k">{{ d.l }}
</span></pre>
      <div class="coord-actions">
        <UButton color="primary" size="lg" :loading="busy" data-testid="proposal-accept" @click="answer(true)">{{ tl('Accept', 'Accepter') }}</UButton>
        <UButton color="neutral" variant="outline" size="lg" :disabled="busy" data-testid="proposal-refuse" @click="answer(false)">{{ tl('Refuse', 'Refuser') }}</UButton>
      </div>
    </section>
    <p v-if="error" class="error coord-error">{{ error }}</p>
  </div>
</template>

<style scoped>
.coord { flex: none; border-bottom: 1px solid var(--line); background: var(--surface); }
.coord-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 16px; }
.coord-head .mono-label { flex: 1; white-space: nowrap; color: var(--muted); }
.coord-warn { flex-wrap: wrap; }
.coord-warn-text { flex: 1 1 calc(100% - 40px); }
.coord-agent { min-height: 36px; padding: 4px 8px; }
.coord-proposal { display: grid; gap: 6px; padding: 8px 16px 12px; border-top: 1px solid var(--line); }
.coord-proposal p { margin: 0; overflow-wrap: anywhere; }
.coord-diff { margin: 0; max-height: 40vh; overflow: auto; padding: 8px; border: 1px solid var(--line); background: var(--bg); font: 12px/1.5 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.coord-diff .add { color: var(--green); }
.coord-diff .del { color: var(--rose); }
.coord-actions { display: flex; gap: 8px; }
.coord-error { margin: 0; padding: 0 16px 8px; }
</style>
