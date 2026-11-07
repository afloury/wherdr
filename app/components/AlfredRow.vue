<script setup lang="ts">
// Alfred, wherdr's assistant: the first row of the agent list, always there
// (projects on or off). Not started: a greyed row; the first time, a sheet
// asks for its program (one tile per one installed on wherdr's machine; no
// model: the user changes it inside Alfred), remembered after. Its ••• menu
// restarts it with another program: the same Alfred (home folder, identity,
// memory), the old session stopped.
import { MAIN } from '#shared/pm/coordinator'
import { alfredPrograms, type AlfredProgram } from '#shared/pm/alfred'

const busy = ref(false)
const error = ref('')
const sheet = ref(false)
const pick = ref('')

const name = computed(() => alfred.value?.name || 'Alfred')
const current = computed(() => (alfredPane.value ? alfred.value?.ran : undefined) ?? alfred.value?.program)
// The programs installed on wherdr's own machine, minus those hidden in Settings › Agents.
const choices = computed(() => alfredPrograms(appConfig.value.machines?.find(m => m.local)?.kinds ?? appConfig.value.kinds, hiddenAgents.value))
const sub = computed(() => {
  if (busy.value) return tl('Starting…', 'Lancement…')
  if (alfredPane.value) return `${current.value ? `${kindLabel(current.value)} · ` : ''}${statusLabel(alfredPane.value)}`
  return current.value ? tl(`not started · ${kindLabel(current.value)}`, `pas lancé · ${kindLabel(current.value)}`) : tl('not started', 'pas lancé')
})
const menu = (): MenuItem[] => [{
  label: alfredPane.value ? tl('Restart with…', 'Relancer avec…') : tl('Start with…', 'Lancer avec…'),
  icon: 'i-lucide-refresh-cw', run: choose,
}]

function choose() {
  pick.value = current.value && choices.value.includes(current.value) ? current.value : choices.value[0] ?? ''
  sheet.value = true
}
async function start(program: AlfredProgram) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  sheet.value = false
  try {
    const p = await launchCoordinator(MAIN, { program, model: '' })
    await loadAlfred()
    if (p) await navigateTo(panePath(p.id))
  }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
// One tap: its conversation, else a start with its agent (chosen first, the first time).
async function open() {
  if (alfredPane.value) return navigateTo(panePath(alfredPane.value.id))
  if (!alfred.value?.program) return choose()
  await start(alfred.value.program)
}
const picked = () => choices.value.find(p => p === pick.value)

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { loadAlfred(); timer = setInterval(loadAlfred, 30_000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="alfred" :class="{ on: !!alfredPane }" data-testid="alfred">
    <button type="button" class="alfred-open" :disabled="busy" data-testid="alfred-open" @click="open">
      <i class="alfred-dot" aria-hidden="true" />
      <span class="alfred-text"><b data-testid="alfred-name">{{ name }}</b><small data-testid="alfred-sub">{{ sub }}</small></span>
      <UIcon v-if="alfredPane" name="i-lucide-chevron-right" class="alfred-go" />
      <span v-else-if="!busy" class="alfred-start">{{ tl('Start', 'Lancer') }}</span>
    </button>
    <SpaceMenu :items="menu" :title="name" :label="`${t('Options')} : ${name}`" class="alfred-more" data-testid="alfred-more" />
  </div>
  <p v-if="error" class="error alfred-error">{{ error }}</p>

  <AppSheet v-model:open="sheet" :title="alfredPane ? tl(`Restart ${name} with…`, `Relancer ${name} avec…`) : alfred?.program ? tl(`Start ${name} with…`, `Lancer ${name} avec…`) : tl('Your assistant’s agent', 'L’agent de ton assistant')">
    <div class="sheet-form" data-testid="alfred-sheet">
      <p class="alfred-note">
        {{ alfred?.program
          ? tl(`The same ${name} carries on: its home folder, identity and memory stay.${alfredPane ? ' The current session stops.' : ''}`, `${name} reprend où il en était : son dossier, son identité et sa mémoire restent.${alfredPane ? ' La session en cours s’arrête.' : ''}`)
          : tl('Alfred is wherdr’s assistant: it helps you get started and coordinates your projects. Pick the agent it runs on; you can change it later from its ••• menu.', 'Alfred est l’assistant de wherdr : il t’aide à démarrer et coordonne tes projets. Choisis l’agent qui le fait tourner ; tu pourras en changer depuis son menu •••.') }}
      </p>
      <label class="field-label">{{ tl('Agent', 'Agent') }}</label>
      <div v-if="choices.length" class="segmented alfred-agents" role="radiogroup" :aria-label="tl('Agent', 'Agent')" :style="{ '--segment-count': choices.length }">
        <button
          v-for="p in choices" :key="p" type="button" role="radio" :class="{ on: p === pick }"
          :aria-checked="p === pick" :data-agent="p" @click="pick = p"
        >
          <AgentAvatar :agent="p" /><span>{{ kindLabel(p) }}</span>
        </button>
      </div>
      <p v-else class="alfred-note" data-testid="alfred-none">{{ tl('Install Claude Code or Codex on this machine to start Alfred.', 'Installe Claude Code ou Codex sur cette machine pour lancer Alfred.') }}</p>
      <p v-if="choices.length" class="alfred-hint muted">{{ tl('It runs with the agent’s default model; change the model inside Alfred.', 'Il tourne avec le modèle par défaut de l’agent ; change de modèle dans Alfred.') }}</p>
    </div>
    <template #footer>
      <div class="sheet-form">
        <UButton block size="xl" color="primary" class="hw-cta" icon="i-lucide-play" :disabled="!picked()" data-testid="alfred-start" @click="start(picked()!)">
          {{ alfredPane ? tl('Restart', 'Relancer') : tl('Start', 'Lancer') }}
        </UButton>
      </div>
    </template>
  </AppSheet>
</template>

<style scoped>
.alfred { display: flex; align-items: stretch; margin-bottom: 20px; border: 1px solid var(--line); background: var(--surface); }
.alfred-open { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; min-height: 52px; padding: 8px 4px 8px 12px; color: var(--text); text-align: left; cursor: pointer; }
.alfred-open:hover:not(:disabled) { background: var(--surface-2); }
.alfred-open:disabled { cursor: progress; }
.alfred-open:focus-visible { outline: 1px solid var(--mauve); outline-offset: -1px; }
.alfred-dot { flex: none; width: 8px; height: 8px; background: var(--dim); }
.alfred.on .alfred-dot { background: var(--green); }
.alfred-text { display: grid; flex: 1; min-width: 0; }
.alfred-text b { font: 600 15px/1.3 var(--display); }
.alfred:not(.on) .alfred-text b { color: var(--text-2); }
.alfred-text small { overflow: hidden; color: var(--muted); font: 12px/1.4 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.alfred-go { flex: none; color: var(--dim); }
.alfred-start { flex: none; color: var(--mauve); font: 500 11px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
/* :deep: on a mouse computer SpaceMenu renders through UDropdownMenu, which drops the scoped attribute. */
.alfred :deep(.alfred-more) { flex: none; align-self: center; margin-right: 4px; }
.alfred-error { margin: -14px 0 14px; }
.alfred-note { margin: 0 2px 14px; color: var(--text-2); font-size: 14px; }
.alfred-agents button { text-transform: none; letter-spacing: .02em; }
.alfred-hint { margin: 8px 2px 0; font-size: 13px; }
</style>
