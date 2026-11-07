<script setup lang="ts">
// "New" sheet › Coordinator: the project (key and name, whether its
// coordinator runs) and the agent to start it with: the user's offered agents
// (Settings › Agents) that can coordinate, the project's default picked. A project without a template points to Settings › Projects; the
// main coordinator (all projects) needs none.
// Its actions (NewCoordinatorActions) sit in the sheet's footer.

const project = defineModel<string>('project', { required: true })
const agent = defineModel<string>('agent', { required: true })
const emit = defineEmits<{ settings: [] }>()

const current = computed(() => coordinators.value.find(c => c.project === project.value))
const choices = computed(() => offerCoordinators())
const fallback = computed(() => (current.value ? coordinatorAgent(current.value)?.program ?? '' : ''))
const running = (project: string) => {
  const c = coordinators.value.find(x => x.project === project)
  return !!c && !!coordinatorPane(c)
}
function pick(key: string) {
  if (key === project.value) return
  haptic()
  project.value = key
}
// Another project: its own default agent.
watch(fallback, (p) => { agent.value = p }, { immediate: true })
</script>

<template>
  <div class="coord-new" data-testid="coordinator-form">
    <label class="field-label">{{ tl('Project', 'Projet') }}</label>
    <div class="coord-projects" role="radiogroup" :aria-label="tl('Project', 'Projet')">
      <button
        v-for="c in coordinators" :key="c.project" type="button" role="radio" :class="{ on: c.project === project }"
        :aria-checked="c.project === project" :data-project="c.project" @click="pick(c.project)"
      >
        <span class="coord-key">{{ c.main ? tl('Main', 'Principal') : c.project }}</span>
        <span class="coord-name">{{ c.main ? tl('All projects', 'Tous les projets') : c.name }}</span>
        <span v-if="running(c.project)" class="coord-state run">{{ tl('Running', 'En cours') }}</span>
        <span v-else-if="!c.main && !c.template" class="coord-state">{{ tl('No template', 'Sans modèle') }}</span>
      </button>
    </div>

    <template v-if="current && !current.main && !current.template">
      <p class="coord-note" data-testid="coordinator-no-template">
        {{ tl('This project needs a template before its coordinator can start.', 'Ce projet a besoin d’un modèle avant de lancer son coordinateur.') }}
        <NuxtLink to="/settings?section=projects" data-testid="coordinator-settings" @click="emit('settings')">{{ tl('Settings › Projects', 'Réglages › Projets') }}</NuxtLink>
      </p>
    </template>
    <template v-else-if="current">
      <label class="field-label">{{ tl('Agent', 'Agent') }}</label>
      <AgentPicker v-model="agent" :programs="choices" />
      <p v-if="fallback" class="coord-hint muted">
        {{ fallback === agent ? tl('The project’s default agent.', 'L’agent par défaut du projet.') : tl(`The default stays ${kindLabel(fallback)}.`, `Le défaut reste ${kindLabel(fallback)}.`) }}
      </p>
      <p v-else class="coord-hint muted" data-testid="coordinator-no-agent">{{ tl('No offered agent can coordinate: check Settings › Agents.', 'Aucun agent proposé ne peut coordonner : vois Réglages › Agents.') }}</p>
    </template>
  </div>
</template>

<style scoped>
.coord-projects { display: grid; border: 1px solid var(--line); }
.coord-projects button {
  display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 10px 12px; text-align: left;
  position: relative; color: var(--text-2);
}
.coord-projects button + button { border-top: 1px solid var(--line); }
.coord-projects button.on { background: var(--surface-2); color: var(--text); }
.coord-projects button.on::before { content: ''; position: absolute; left: -1px; top: -1px; bottom: -1px; width: 2px; background: var(--mauve); }
.coord-key { flex: none; font: 500 12px/1 var(--mono); letter-spacing: .08em; }
.coord-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.coord-state { flex: none; font: 500 10.5px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
.coord-state.run { color: var(--green); }
.coord-note { margin: 14px 2px 0; font-size: 14px; color: var(--text-2); }
.coord-note a { color: var(--mauve); text-decoration: underline; }
.coord-hint { margin: 8px 2px 0; font-size: 13px; }
</style>
