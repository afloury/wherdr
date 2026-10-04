<script setup lang="ts">
// TEMPORARY (t-0199, concept d): "point by point" — the agent reply split
// into its points (paragraphs, list items), one answer field each; the
// questions are open, the other points open on a tap. Only the points
// answered are sent, each quoted above its answer, then the general word.
import { sheet, type SheetItem } from '~/utils/replyUx'

const props = defineProps<{ paneId: string }>()
const emit = defineEmits<{ send: [items: SheetItem[], general: string] }>()
const open = computed({
  get: () => Boolean(sheet.value && sheet.value.paneId === props.paneId),
  set: (v: boolean) => { if (!v) sheet.value = null },
})
const answered = computed(() => sheet.value?.items.filter(i => i.answer.trim()).length || 0)
const listEl = ref<HTMLElement | null>(null)
function openItem(it: SheetItem) {
  it.open = true
  nextTick(() => listEl.value?.querySelector<HTMLTextAreaElement>(`[data-item="${it.id}"] textarea`)?.focus())
}
watch(() => sheet.value?.focus, id => {
  if (id) setTimeout(() => listEl.value?.querySelector<HTMLTextAreaElement>(`[data-item="${id}"] textarea`)?.focus(), 250)
})
function send() {
  if (!sheet.value) return
  emit('send', sheet.value.items, sheet.value.general)
}
</script>

<template>
  <AppSheet v-model:open="open" :title="tl('Answer point by point', 'Répondre point par point')" wide screen>
    <div v-if="sheet" ref="listEl" class="rd-sheet">
      <p class="rd-meta">
        <span>{{ sheet.time ? tl(`Reply of ${sheet.time}`, `Réponse de ${sheet.time}`) : tl('Quotes', 'Citations') }}</span>
        <span class="sep">·</span><span>{{ tl(`${sheet.items.filter(i => !i.sub).length} points`, `${sheet.items.filter(i => !i.sub).length} points`) }}</span>
        <span class="sep">·</span><span class="rd-meta-n">{{ tl(`${answered} answered`, `${answered} répondu${answered > 1 ? 's' : ''}`) }}</span>
      </p>
      <ol class="rd-points">
        <li v-for="it in sheet.items" :key="it.id" class="rd-point" :class="{ q: it.question, open: it.open, done: it.answer.trim(), sub: it.sub }" :data-item="it.id">
          <div class="rd-point-head">
            <span class="rd-num">{{ it.sub ? '↳' : String(sheet.items.filter(x => !x.sub).indexOf(it) + 1).padStart(2, '0') }}</span>
            <span class="rd-text">{{ it.sub ? `« ${it.text} »` : it.text }}</span>
          </div>
          <UTextarea
            v-if="it.open" v-model="it.answer" :rows="1" :maxrows="5" autoresize variant="none" autocapitalize="sentences"
            :placeholder="tl('Your answer…', 'Ta réponse…')" class="rd-field" :ui="{ base: 'rd-input' }"
          />
          <button v-else type="button" class="rd-add" @click="openItem(it)">+ {{ tl('Answer this point', 'Répondre à ce point') }}</button>
        </li>
      </ol>
    </div>
    <template #footer>
      <div v-if="sheet" class="rd-foot">
        <UTextarea
          v-model="sheet.general" :rows="1" :maxrows="3" autoresize variant="none" autocapitalize="sentences"
          :placeholder="tl('A general word (optional)…', 'Un mot général (facultatif)…')" class="rd-general" :ui="{ base: 'rd-input' }"
        />
        <UButton color="primary" variant="solid" class="rd-send" :disabled="!answered && !sheet.general.trim()" @click="send">
          {{ answered ? tl(`Send ${answered} answer${answered > 1 ? 's' : ''}`, `Envoyer ${answered} réponse${answered > 1 ? 's' : ''}`) : tl('Send', 'Envoyer') }}
        </UButton>
      </div>
    </template>
  </AppSheet>
</template>
