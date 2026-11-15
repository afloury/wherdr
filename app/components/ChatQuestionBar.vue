<script setup lang="ts">
// "List" reply style: the questions of an agent message as buttons under it,
// with their "Quoted" and Yes/No state read from the draft. The draft is read
// here, so typing re-renders this bar and not the whole conversation.
import { answerOf, isQuoted, tappedAnswer, type Answer, type ReplyTargets } from '~/utils/questionReply'
import { pointRef, type Reference } from '#shared/reference'

const props = defineProps<{ paneId: string, targets: ReplyTargets, time: string | null, rid: string, picking: boolean }>()
const emit = defineEmits<{ quote: [ref: Reference], answer: [ref: Reference, a: Answer, click: boolean], hot: [n: string, on: boolean], pick: [] }>()
const draftText = computed(() => useDraft(props.paneId).text)
const refOf = (text: string) => pointRef(text, props.time, props.rid)
const quoted = (text: string) => isQuoted(draftText.value, refOf(text))
const answered = (text: string, a: Answer) => tappedAnswer(answerOf(draftText.value, refOf(text)) || '') === a
const answerWord = (a: Answer) => a === 'yes' ? t('Yes') : t('No')
</script>

<template>
  <div class="q-bar">
    <template v-if="targets.questions.length">
      <p class="q-bar-h">{{ tl('Questions · reply to', 'Questions · répondre à') }}</p>
      <div v-for="q in targets.questions" :key="q.n" class="q-line">
        <button
          type="button" class="q-row" :class="{ quoted: quoted(q.text) }"
          :aria-label="`${t('Reply')}: ${q.text}`" @click="emit('quote', refOf(q.text))"
          @mouseenter="emit('hot', q.n, true)" @mouseleave="emit('hot', q.n, false)" @focus="emit('hot', q.n, true)" @blur="emit('hot', q.n, false)"
        >
          <b>{{ quoted(q.text) ? '✓' : q.n }}</b><span>{{ q.text }}</span><i>↳<em> {{ quoted(q.text) ? t('Quoted') : t('Reply') }}</em></i>
        </button>
        <template v-if="q.closed">
          <button
            v-for="a in (['yes', 'no'] as const)" :key="a" type="button" class="q-row-ans" :aria-pressed="answered(q.text, a)"
            :aria-label="`${answerWord(a)}: ${q.text}`" @click="emit('answer', refOf(q.text), a, $event.detail > 0)"
          >{{ answerWord(a) }}</button>
        </template>
      </div>
    </template>
    <button v-if="targets.pick" type="button" class="q-pick" :aria-pressed="picking" @click="emit('pick')">
      {{ picking ? tl('Pick the point to quote · Cancel', 'Choisis le point à citer · Annuler') : tl('+ Quote a point', '+ Citer un point') }}
    </button>
  </div>
</template>
