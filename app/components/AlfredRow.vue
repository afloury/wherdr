<script setup lang="ts">
// Alfred, wherdr's assistant: the first row of the agent list, always there
// (projects on or off). Not started: a greyed row; the first time, a sheet
// asks for its program (the offered agents of Settings › Agents installed on
// wherdr's machine, in the user's order; no model: the user changes it inside Alfred), remembered after. Its menu
// (right click, or long press on a touch screen) restarts it with another
// program: the same Alfred (home folder, identity, memory), the old session
// stopped. As a banner (the board's All projects): the same one tap, no menu.
// In the list it is a card of its own: its emblem, what it is, its live state,
// and an Ask field that opens its conversation with the text in its draft.
import { MAIN } from '#shared/pm/coordinator'
import type { AlfredProgram } from '#shared/pm/alfred'

const props = defineProps<{ banner?: boolean }>()
const busy = ref(false)
const error = ref('')
const sheet = ref(false)
const pick = ref('')
const question = ref('')
// Text from the Ask field, put in its draft once its conversation exists.
let asked = ''

const name = computed(() => alfred.value?.name || 'Alfred')
const current = computed(() => (alfredPane.value ? alfred.value?.ran : undefined) ?? alfred.value?.program)
const choices = alfredPrograms
// Its conversation is the one open: the same selected style as agent cards.
const selected = computed(() => !props.banner && !!alfredPane.value && alfredPane.value.id === curPane.value)
const kind = computed(() => (current.value ? ` · ${kindLabel(current.value)}` : ''))
const sub = computed(() => {
  if (busy.value) return tl('Starting…', 'Lancement…')
  if (alfredPane.value) return `${statusLabel(alfredPane.value)}${kind.value}`
  return `${tl('Not started', 'Pas lancé')}${kind.value}`
})
// Its state square, as on agent cards: hollow when not started.
const tone = computed(() => (busy.value ? 'working' : alfredPane.value ? statusKey(alfredPane.value) : 'inactive'))
const menu = (): MenuItem[] => (props.banner ? [] : [{
  label: alfredPane.value ? tl('Restart with…', 'Relancer avec…') : tl('Start with…', 'Lancer avec…'),
  icon: 'i-lucide-refresh-cw', run: choose,
}])
const rowMenu = useRowMenu()

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
    const p = await launchCoordinator(MAIN, { program })
    await loadAlfred()
    if (p) await go(p.id)
  }
  catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
function go(id: string) {
  if (asked) useDraft(id).text = asked
  asked = ''
  return navigateTo(panePath(id))
}
// One tap: its conversation, else a start with its agent (chosen first, the first time).
async function open() {
  if (rowMenu.swallowClick()) return
  if (alfredPane.value) return go(alfredPane.value.id)
  // Its program unchecked in Settings since: pick another.
  if (!alfred.value?.program || !choices.value.includes(alfred.value.program)) return choose()
  await start(alfred.value.program)
}
// Ask field: the typed text waits in its composer, not sent.
function ask() {
  asked = question.value.trim()
  question.value = ''
  return open()
}
watch(sheet, (o) => { if (!o && !busy.value) asked = '' })
const picked = () => choices.value.find(p => p === pick.value)

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { loadAlfred(); timer = setInterval(loadAlfred, 30_000) })
// A rename lands in identity.md during one of its turns: read the name again
// as soon as its status changes (pushed live), not at the next poll.
watch(() => alfredPane.value?.status, (s, was) => { if (was && s !== was) loadAlfred() })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="alfred-card" :class="{ on: !!alfredPane, banner, sel: selected }">
  <UContextMenu :disabled="sheetMenus || banner" :items="rowMenu.dropdown(menu)" :press-open-delay="700" :ui="{ content: 'hw-dropdown' }" @update:open="rowMenu.opened">
  <div class="alfred" data-testid="alfred" :class="{ on: !!alfredPane, sel: selected }" v-on="rowMenu.on(menu, name)">
    <button type="button" class="alfred-open" :disabled="busy" data-testid="alfred-open" :aria-current="selected ? 'page' : undefined" @click="open">
      <span class="alfred-mark"><AlfredEmblem class="alfred-mark-emblem" /></span>
      <span class="alfred-text">
        <span class="alfred-head"><b data-testid="alfred-name">{{ name }}</b><span v-if="!alfredPane && !busy" class="alfred-start">{{ tl('Start', 'Lancer') }}</span></span>
        <small v-if="!banner" class="alfred-role">{{ tl('Your assistant · all projects', 'Ton assistant · tous les projets') }}</small>
        <small class="alfred-sub pill" :class="tone" data-testid="alfred-sub"><i aria-hidden="true" />{{ banner ? `${tl('All projects', 'Tous les projets')} · ${sub}` : sub }}</small>
      </span>
      <UIcon v-if="alfredPane" name="i-lucide-chevron-right" class="alfred-go" />
    </button>
  </div>
  </UContextMenu>
  <form v-if="!banner" class="alfred-ask" @submit.prevent="ask">
    <input v-model="question" type="text" enterkeyhint="go" :placeholder="tl(`Ask ${name}…`, `Demander à ${name}…`)" :aria-label="tl(`Ask ${name}`, `Demander à ${name}`)" :disabled="busy" data-testid="alfred-ask">
  </form>
  </div>
  <p v-if="error" class="error alfred-error">{{ error }}</p>

  <AppSheet v-model:open="sheet" :title="alfredPane ? tl(`Restart ${name} with…`, `Relancer ${name} avec…`) : alfred?.program ? tl(`Start ${name} with…`, `Lancer ${name} avec…`) : tl('Your assistant’s agent', 'L’agent de ton assistant')">
    <div class="sheet-form" data-testid="alfred-sheet">
      <p class="alfred-note">
        {{ alfred?.program
          ? tl(`The same ${name} carries on: its home folder, identity and memory stay.${alfredPane ? ' The current session stops.' : ''}`, `${name} reprend où il en était : son dossier, son identité et sa mémoire restent.${alfredPane ? ' La session en cours s’arrête.' : ''}`)
          : tl('Alfred is wherdr’s assistant: it helps you get started and coordinates your projects. Pick the agent it runs on; you can change it later from its menu (right click or long press).', 'Alfred est l’assistant de wherdr : il t’aide à démarrer et coordonne tes projets. Choisis l’agent qui le fait tourner ; tu pourras en changer depuis son menu (clic droit ou appui long).') }}
      </p>
      <label class="field-label">{{ tl('Agent', 'Agent') }}</label>
      <AgentPicker v-if="choices.length" v-model="pick" :programs="choices" class="alfred-agents" />
      <p v-else class="alfred-note" data-testid="alfred-none">{{ tl('No offered agent on this machine can run Alfred: install one (Claude Code, Codex, OMP…) or check it in Settings › Agents.', 'Aucun agent proposé sur cette machine ne peut faire tourner Alfred : installe-en un (Claude Code, Codex, OMP…) ou coche-le dans Réglages › Agents.') }}</p>
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
/* A card of its own: a faint mauve wash, a mauve edge when its conversation is open. */
.alfred-card { position: relative; margin-bottom: 20px; border: 1px solid color-mix(in srgb, var(--mauve) 35%, var(--line)); background: linear-gradient(135deg, color-mix(in srgb, var(--mauve) 8%, var(--surface)), var(--surface) 70%); }
.alfred-card::before { content: ''; position: absolute; z-index: 1; left: -1px; top: -1px; bottom: -1px; width: 2px; background: transparent; }
.alfred-card.sel::before { background: var(--mauve); }
.alfred-card.banner { flex: none; margin: 0; border-width: 0 0 1px; background: var(--surface); }
.alfred-card.banner .alfred-open { min-height: 52px; padding: 8px 16px; }
.alfred { display: flex; align-items: stretch; }
.alfred.sel { background: color-mix(in srgb, var(--surface-2) 80%, transparent); }
.alfred-open { display: flex; flex: 1; align-items: center; gap: 12px; min-width: 0; min-height: 64px; padding: 10px 12px; color: var(--text); text-align: left; cursor: pointer; }
.alfred-open:hover:not(:disabled) { background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
.alfred-open:disabled { cursor: progress; }
.alfred-open:focus-visible { outline: 1px solid var(--mauve); outline-offset: -1px; }
.alfred-mark { display: grid; flex: none; place-items: center; width: 40px; height: 40px; border: 1px solid var(--line); background: var(--surface); color: var(--text); }
.alfred-card:not(.on) .alfred-mark { color: var(--muted); }
.alfred-card.banner .alfred-mark { width: 32px; height: 32px; }
.alfred-mark-emblem { width: 24px; }
.alfred-card.banner .alfred-mark-emblem { width: 18px; }
.alfred-text { display: grid; flex: 1; gap: 1px; min-width: 0; }
.alfred-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.alfred-text b { overflow: hidden; font: 600 16px/1.25 var(--display); text-overflow: ellipsis; white-space: nowrap; }
.alfred-card:not(.on) .alfred-text b { color: var(--text-2); }
.alfred-text small { overflow: hidden; font: 12px/1.4 var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.alfred-role { color: var(--text-2); }
.alfred-sub.pill { display: flex; align-items: center; gap: 6px; min-width: 0; }
.alfred-go { flex: none; color: var(--dim); }
.alfred-start { flex: none; color: var(--mauve); font: 500 11px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; }
.alfred-ask { border-top: 1px solid var(--line-soft); }
.alfred-ask input { display: block; width: 100%; min-height: 44px; padding: 0 12px 0 64px; border: 0; background: transparent; color: var(--text); font: 14px/1.4 var(--sans); outline: none; }
@media (pointer: coarse) { .alfred-ask input { font-size: 16px; } }
.alfred-ask input::placeholder { color: var(--muted); }
.alfred-ask input:focus-visible { box-shadow: inset 0 0 0 1px var(--mauve); }
.alfred-error { margin: -14px 0 14px; }
.alfred-card.banner + .alfred-error { margin: 8px 16px; }
.alfred-note { margin: 0 2px 14px; color: var(--text-2); font-size: 14px; }
.alfred-hint { margin: 8px 2px 0; font-size: 13px; }
</style>
