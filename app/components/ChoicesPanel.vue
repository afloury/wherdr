<script setup lang="ts">
// Blocking prompt of the open agent: question + options as big buttons.
// Recognized waiting screen (`screen`: Codex hooks, trust, login…):
// its title, a line of explanation, the box text, and the keys of its
// legend as buttons ("Trust all (t)"). Nothing is sent without a click.
import type { Choices, WaitAction, WaitScreen } from '#shared/types'

const props = defineProps<{ paneId: string, prompt?: Choices | null, screen?: WaitScreen | null, keys?: boolean }>()
const busy = ref(false)
watch(() => [props.prompt, props.screen], () => { busy.value = false })

// With options, Enter already confirms them: we only keep the other keys (Escape…).
const actions = computed(() => (props.screen ? props.screen.actions.filter(a => !(props.prompt && a.key === 'enter')) : []))
const note = computed(() => (props.screen ? screenNote(props.screen.kind) : null))
// Aligned columns (hooks table): no wrapping; running text: wrapping.
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
// Checkboxes (omp): Enter moves to the next question.
async function next() {
  busy.value = true
  if (!(await navKey(props.paneId, 'enter'))) busy.value = false
}

// Keyboard (computer, active view) on a prompt with options: ↑ ↓ Enter Escape
// go to the terminal (the card follows the re-read screen), 1-9 picks the option.
const disabled = computed(() => busy.value || !eventsOpen.value || offlineView.value)
const keyboard = computed(() => Boolean(props.keys && desk.value && props.prompt && props.prompt.options.length && !disabled.value))
useCardKeys(() => keyboard.value, () => ({ digits: Math.min(9, props.prompt?.options.length || 0), enter: true }), (k) => {
  const p = props.prompt
  if (!p) return
  if (k.kind === 'digit') return pick(k.n - 1, p.options[k.n - 1]!.label)
  navKey(props.paneId, k.key)
})
</script>

<template>
  <div class="choices" :class="{ 'choices-screen': screen }">
    <p class="eyebrow choices-eyebrow"><i />{{ t('À toi') }}</p>
    <!-- Permission request: what is requested, instead of the raw box text. -->
    <PromptDetailBlock v-if="prompt?.detail" :detail="prompt.detail" />
    <p v-if="question" class="choices-q">{{ question }}</p>
    <p v-if="note" class="choices-note">{{ note }}</p>
    <pre v-if="screen && screen.lines.length && !prompt?.detail" class="choices-screen-text" :class="{ wrap: !tabular }">{{ screen.lines.join('\n') }}</pre>
    <div v-if="prompt" class="choices-list" :class="{ multi: prompt.multi }">
      <button
        v-for="(o, i) in prompt.options" :key="i" type="button" :class="{ cur: i === prompt.cursor, on: o.checked }"
        :aria-pressed="prompt.multi ? Boolean(o.checked) : undefined"
        :disabled="busy || !eventsOpen || offlineView" @click="pick(i, o.label)"
      >
        <span v-if="prompt.multi" class="n"><UIcon :name="o.checked ? 'i-lucide-square-check' : 'i-lucide-square'" /></span>
        <span v-else class="n">{{ i + 1 }}</span>
        <span class="l">{{ o.label }}<small v-if="o.hint">{{ o.hint }}</small></span>
      </button>
      <button v-if="prompt.multi" type="button" class="choices-next" :disabled="busy || !eventsOpen || offlineView" @click="next">
        {{ t('Continuer') }}<kbd>{{ screenKeyName('enter') }}</kbd>
      </button>
    </div>
    <div v-if="actions.length || keyboard" class="choices-keys">
      <button
        v-for="a in actions" :key="a.key + a.label" type="button"
        :disabled="busy || !eventsOpen || offlineView" @click="press(a)"
      >
        {{ screenActionText(a) }}<kbd>{{ screenKeyName(a.key) }}</kbd>
      </button>
      <span v-if="keyboard" class="card-kbd" aria-hidden="true"><kbd>↑↓</kbd><kbd>{{ screenKeyName('enter') }}</kbd><kbd>1–{{ Math.min(9, prompt!.options.length) }}</kbd></span>
    </div>
  </div>
</template>
