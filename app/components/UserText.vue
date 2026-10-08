<script setup lang="ts">
// Text of a user message: the user's own words (folded when long), then each
// long pasted text as a card (see shared/pastedText.ts).
import { splitPasted } from '#shared/pastedText'
import { sentPastes } from '~/utils/sentPastes'

const props = defineProps<{ text: string, pasted?: string[] }>()
const split = computed(() => splitPasted(props.text, props.pasted, sentPastes.value))
</script>

<template>
  <FoldText v-if="split.text"><QuotedText :text="split.text" /></FoldText><span v-if="split.pastes.length" class="msg-pastes"><PastedCard v-for="(p, i) in split.pastes" :key="i" :text="p" /></span>
</template>
