<script setup lang="ts">
// "New" sheet › Coordinator, footer: open the project's coordinator when it
// runs with the chosen agent, else start it (same API and rules as the
// CoordinatorBar: a running conversation of another agent offers a new
// conversation first, or resuming it).
import { agentChoices, agentKey, agentName, sameAgent } from '#shared/pm/coordinator'

const props = defineProps<{ project: string, agent: string }>()
const emit = defineEmits<{ done: [] }>()
const busy = ref(false)
const error = ref('')

const c = computed(() => coordinators.value.find(x => x.project === props.project))
const chosen = computed(() => (c.value ? agentChoices(c.value).find(a => agentKey(a) === props.agent) ?? c.value.agent : undefined))
const pane = computed(() => (c.value ? coordinatorPane(c.value) : undefined))
// Its conversation runs with another agent than the chosen one (a resume the
// user already chose for the default agent is no longer asked).
const other = computed(() => !!pane.value && !!c.value?.ran && !sameAgent(c.value.ran, chosen.value)
  && !(sameAgent(chosen.value, c.value.agent) && resumedCoordinators.value.includes(c.value.terminal!)))

function go(id: string) {
  haptic()
  emit('done')
  navigateTo(panePath(id))
}
async function start() {
  if (!c.value || !chosen.value) return
  busy.value = true
  error.value = ''
  try {
    const p = await launchCoordinator(c.value.project, sameAgent(chosen.value, c.value.agent) ? undefined : chosen.value)
    if (p) go(p.id)
    else emit('done')
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
function resume() {
  resumeCoordinator(c.value!.terminal!)
  go(pane.value!.id)
}
</script>

<template>
  <div class="sheet-form coord-new-actions" data-testid="coordinator-actions">
    <p v-if="error" class="form-error">{{ error }}</p>
    <template v-if="c && other && c.ran">
      <p class="coord-warn muted" data-testid="coordinator-other-agent">
        {{ tl(`Its conversation runs with ${agentName(c.ran)}.`, `Sa conversation tourne avec ${agentName(c.ran)}.`) }}
      </p>
      <UButton block size="xl" color="primary" class="hw-cta" icon="i-lucide-play" :loading="busy" data-testid="coordinator-new" @click="start">
        {{ tl(`New conversation with ${agentName(chosen!)}`, `Nouvelle conversation avec ${agentName(chosen!)}`) }}
      </UButton>
      <UButton block size="xl" color="neutral" variant="outline" :disabled="busy" data-testid="coordinator-resume" @click="resume">
        {{ tl(`Resume with ${agentName(c.ran)}`, `Reprendre avec ${agentName(c.ran)}`) }}
      </UButton>
    </template>
    <UButton v-else-if="pane" block size="xl" color="primary" class="hw-cta" icon="i-lucide-arrow-right" data-testid="coordinator-open" @click="go(pane.id)">
      {{ tl('Open', 'Ouvrir') }}
    </UButton>
    <UButton
      v-else block size="xl" color="primary" class="hw-cta" icon="i-lucide-play" :loading="busy" :disabled="!c?.template || !chosen"
      data-testid="coordinator-start" @click="start"
    >
      {{ chosen ? tl(`Start with ${agentName(chosen)}`, `Lancer avec ${agentName(chosen)}`) : tl('Start', 'Lancer') }}
    </UButton>
  </div>
</template>

<style scoped>
.coord-new-actions { display: grid; gap: 8px; }
.coord-warn { margin: 0 2px; font-size: 13px; }
</style>
