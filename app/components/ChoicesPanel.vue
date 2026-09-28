<script setup lang="ts">
// Invite bloquante de l'agent ouvert : question + options en gros boutons.
// Écran d'attente reconnu (`screen` : hooks de Codex, confiance, connexion…) :
// son titre, une ligne d'explication, le texte de la boîte, et les touches de sa
// légende en boutons (« Tout approuver (t) »). Rien n'est envoyé sans un clic.
import type { Choices, WaitAction, WaitScreen } from '#shared/types'

const props = defineProps<{ paneId: string, prompt?: Choices | null, screen?: WaitScreen | null }>()
const busy = ref(false)
watch(() => [props.prompt, props.screen], () => { busy.value = false })

// Avec des options, Entrée les valide déjà : on ne garde que les autres touches (Échap…).
const actions = computed(() => (props.screen ? props.screen.actions.filter(a => !(props.prompt && a.key === 'enter')) : []))
const note = computed(() => (props.screen ? screenNote(props.screen.kind) : null))
// Colonnes alignées (tableau des hooks) : pas de retour à la ligne ; texte courant : si.
const tabular = computed(() => Boolean(props.screen && props.screen.lines.some(l => /\S {3,}\S/.test(l))))
const question = computed(() => (props.screen && props.screen.title) || (props.prompt && props.prompt.question))

async function pick(i: number, label: string) {
  busy.value = true
  if (!(await choose(props.paneId, i, label))) busy.value = false
}
async function press(a: WaitAction) {
  busy.value = true
  if (!(await pressScreenKey(props.paneId, a))) busy.value = false
}
</script>

<template>
  <div class="choices" :class="{ 'choices-screen': screen }">
    <p class="eyebrow choices-eyebrow"><i />{{ t('À toi') }}</p>
    <p v-if="question" class="choices-q">{{ question }}</p>
    <p v-if="note" class="choices-note">{{ note }}</p>
    <pre v-if="screen && screen.lines.length" class="choices-screen-text" :class="{ wrap: !tabular }">{{ screen.lines.join('\n') }}</pre>
    <div v-if="prompt" class="choices-list">
      <button
        v-for="(o, i) in prompt.options" :key="i" type="button" :class="{ cur: i === prompt.cursor }"
        :disabled="busy || !eventsOpen || offlineView" @click="pick(i, o.label)"
      >
        <span class="n">{{ i + 1 }}</span><span class="l">{{ o.label }}<small v-if="o.hint">{{ o.hint }}</small></span>
      </button>
    </div>
    <div v-if="actions.length" class="choices-keys">
      <button
        v-for="a in actions" :key="a.key + a.label" type="button"
        :disabled="busy || !eventsOpen || offlineView" @click="press(a)"
      >
        {{ screenActionText(a) }}<kbd>{{ screenKeyName(a.key) }}</kbd>
      </button>
    </div>
  </div>
</template>
