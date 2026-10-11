<script setup lang="ts">
// Text of a user message: each reference ("↳ … —" line, see
// shared/reference.ts) shown as a quote, its answer below it. A tap on a quote
// of the conversation shows the agent message it names. Runs of "> " lines,
// as quotes were written before, show as quotes too.
import { refSegments, type Reference } from '#shared/reference'

const props = defineProps<{ text: string }>()
// Blank lines around a quote only set it apart in the message as sent.
const segments = computed(() => refSegments(props.text)
  .map(s => (s.kind === 'ref' ? s : { ...s, text: s.text.replace(/^\n+|\n+$/g, '') }))
  .filter(s => s.kind === 'ref' || s.text))
const goto = inject<((ref: Reference, el: HTMLElement) => void) | null>('gotoRef', null)
// What a quote names, before its excerpt: "11:37", "11:37 · #3", "Decision".
const meta = (r: Reference) => (r.kind === 'task' ? r.label.replace(/\s*:$/, '') : [r.time, r.n ? `#${r.n}` : ''].filter(Boolean).join(' · '))
</script>

<template>
  <template v-for="(s, i) in segments" :key="i">
    <component
      :is="goto && s.ref.kind !== 'task' ? 'button' : 'span'" v-if="s.kind === 'ref'" class="msg-ref" :data-kind="s.ref.kind"
      :type="goto && s.ref.kind !== 'task' ? 'button' : undefined" :aria-label="goto && s.ref.kind !== 'task' ? `${t('Show original message')}: ${s.ref.excerpt}` : undefined"
      @click="goto && s.ref.kind !== 'task' && goto(s.ref, $event.currentTarget as HTMLElement)"
    >
      <span class="msg-ref-mark" aria-hidden="true">↳</span><span v-if="meta(s.ref)" class="msg-ref-meta">{{ meta(s.ref) }}</span><span class="msg-ref-text">{{ s.ref.excerpt }}</span>
    </component>
    <span v-else-if="s.kind === 'quote'" class="msg-q">{{ s.text }}</span>
    <template v-else>{{ s.text }}</template>
  </template>
</template>
