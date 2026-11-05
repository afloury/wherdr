<script setup lang="ts">
// Decisions: everything waiting for the user's choice, grouped, the
// recommended answer first, one tap each. An agent's permission prompt is
// answered right here with its own buttons; a question opens the agent.
import { decisionGroups, type Decision, type DecisionGroup } from '#shared/pm/decisions'
import type { Choice } from '#shared/pm/verdict'

const list = ref<Decision[] | null>(null)
const error = ref('')
const busy = ref('')

async function load() {
  try { list.value = await api<Decision[]>('/api/pm/decisions'); error.value = '' }
  catch (e) { error.value = (e as Error).message }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { load(); timer = setInterval(load, 10_000) })
onBeforeUnmount(() => clearInterval(timer))

const groups = computed(() => decisionGroups(list.value ?? []))
const GROUP_LABEL: Record<DecisionGroup, [string, string]> = {
  agent: ['Agents waiting', 'Agents en attente'], arbitrate: ['Reviews to settle', 'Relectures à trancher'], proposal: ['Coordinator proposals', 'Propositions du coordinateur'],
  step: ['Your steps', 'Tes étapes'], overdue: ['Overdue steps', 'Étapes en retard'], coordinator: ['Coordinator not answering', 'Coordinateur sans réponse'],
}
const CHOICE_LABEL: Record<Choice, [string, string]> = {
  pass: ['Pass', 'Valider'], round: ['One more round', 'Un tour de plus'], worker: ['The agent is right', 'L’agent a raison'], reviewer: ['The reviewer is right', 'Le relecteur a raison'],
  split: ['Split the rest', 'Séparer le reste'], swap: ['Change agent', 'Changer d’agent'], abandon: ['Abandon', 'Abandonner'],
}
const paneOf = (d: Decision) => (d.terminal ? herdrState.value?.panes.find(p => p.coreAddress === d.terminal) : undefined)
// The agent's prompt, when herdr-core reads one on its screen.
const promptOf = (d: Decision) => { const p = paneOf(d); return p?.status === 'blocked' && p.prompt?.options ? p.prompt : null }

async function act(d: Decision, fn: () => Promise<unknown>) {
  busy.value = d.id
  error.value = ''
  try { await fn(); await load() }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = '' }
}
const decide = (d: Decision, choice: Choice) => act(d, () => api('/api/pm/decide', { id: d.task, choice }))
const step = (d: Decision) => act(d, () => api('/api/pm/step-user', { id: d.task }))
const proposal = (d: Decision, accept: boolean) => act(d, () => api('/api/pm/template-proposal', { project: d.project, accept }))
const runNow = (d: Decision) => act(d, () => api('/api/pm/autopilot', { project: d.project, runNow: true }))
</script>

<template>
  <section id="decisions" class="view decisions" data-testid="decisions">
    <header class="board-top">
      <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="lg" class="icon-btn back" :aria-label="t('Back')" to="/board" />
      <h1 class="display">{{ tl('Decisions', 'Décisions') }}</h1>
      <span v-if="list" class="mono-label">{{ list.length }}</span>
    </header>
    <p v-if="error" class="error board-note" role="alert">{{ error }}</p>
    <p v-if="list && !list.length" class="muted board-note" data-testid="decisions-empty">{{ tl('Nothing waits for you.', 'Rien ne t’attend.') }}</p>
    <div class="decisions-list">
      <section v-for="g in groups" :key="g.group" class="decisions-group" :data-group="g.group" data-testid="decisions-group">
        <h2 class="mono-label">{{ tl(...GROUP_LABEL[g.group]) }} <span>{{ g.items.length }}</span></h2>
        <article v-for="d in g.items" :key="d.id" class="decision" :data-decision="d.id" data-testid="decision">
          <span class="mono-label muted">{{ d.task ?? d.project }}</span>
          <b>{{ d.title }}</b>
          <p class="decision-text">{{ d.text }}</p>
          <ChoicesPanel v-if="g.group === 'agent' && promptOf(d)" :pane-id="paneOf(d)!.id" :prompt="promptOf(d)" />
          <div class="decision-actions">
            <template v-if="g.group === 'arbitrate'">
              <UButton v-for="o in d.options" :key="o" size="lg" :color="o === d.recommend ? 'primary' : 'neutral'" :variant="o === d.recommend ? 'solid' : 'outline'"
                :loading="busy === d.id && o === d.recommend" :disabled="!!busy" :data-choice="o" @click="decide(d, o)">
                {{ tl(...CHOICE_LABEL[o]) }}<template v-if="o === d.recommend"> · {{ tl('recommended', 'conseillé') }}</template>
              </UButton>
            </template>
            <UButton v-else-if="g.group === 'step'" color="primary" size="lg" :loading="busy === d.id" :disabled="!!busy" data-testid="decision-step" @click="step(d)">{{ d.label }}</UButton>
            <template v-else-if="g.group === 'proposal'">
              <UButton color="primary" size="lg" :loading="busy === d.id" :disabled="!!busy" data-testid="decision-accept" @click="proposal(d, true)">{{ tl('Accept', 'Accepter') }}</UButton>
              <UButton color="neutral" variant="outline" size="lg" :disabled="!!busy" @click="proposal(d, false)">{{ tl('Refuse', 'Refuser') }}</UButton>
              <UButton color="neutral" variant="ghost" size="lg" to="/board">{{ tl('Show diff', 'Voir le diff') }}</UButton>
            </template>
            <UButton v-else-if="g.group === 'coordinator'" color="primary" size="lg" icon="i-lucide-play" :loading="busy === d.id" :disabled="!!busy" data-testid="decision-run-now" @click="runNow(d)">{{ tl('Run now', 'Lancer maintenant') }}</UButton>
            <UButton v-if="(g.group === 'agent' || g.group === 'overdue') && paneOf(d)" :color="promptOf(d) ? 'neutral' : 'primary'" :variant="promptOf(d) ? 'ghost' : 'solid'" size="lg" icon="i-lucide-terminal" :to="panePath(paneOf(d)!.id)" data-testid="decision-open">
              {{ tl('Open the agent', 'Ouvrir l’agent') }}
            </UButton>
          </div>
        </article>
      </section>
    </div>
  </section>
</template>

<style scoped>
.decisions { color: var(--text); }
.board-top { flex: none; display: flex; align-items: center; gap: 8px; min-height: calc(44px + var(--safe-top, 0px)); padding: var(--safe-top, 0px) 16px 0 8px; border-bottom: 1px solid var(--line); }
.board-top h1 { flex: 1; margin: 0; font-size: 20px; }
.board-note { padding: 12px 16px; margin: 0; }
.decisions-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-bottom: var(--safe-bottom, 0px); }
.decisions-group { border-bottom: 1px solid var(--line); padding: 12px 16px; display: grid; gap: 8px; max-width: 760px; }
.decisions-group h2 { margin: 0; display: flex; justify-content: space-between; color: var(--blocked); }
.decision { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--line); background: var(--surface); }
.decision-text { margin: 0; color: var(--text-2); white-space: pre-wrap; overflow-wrap: anywhere; }
.decision-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.decision-actions:empty { display: none; }
</style>
