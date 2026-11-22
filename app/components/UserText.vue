<script setup lang="ts">
// Text of a user message: the user's own words (folded when long), then each
// long pasted text as the message field's tile (see shared/pastedText.ts); a
// tap opens the whole text with Copy (PastedSheet).
import { splitPasted } from '#shared/pastedText'
import { sentPastes } from '~/utils/sentPastes'
import { pasteTile } from '~/utils/attachTiles'

const props = defineProps<{ text: string, pasted?: string[] }>()
const split = computed(() => splitPasted(props.text, props.pasted, sentPastes.value))
const opened = ref<string | null>(null)
</script>

<template>
  <FoldText v-if="split.text"><QuotedText :text="split.text" /></FoldText><span v-if="split.pastes.length" class="msg-pastes">
    <AttachTile v-for="(p, i) in split.pastes" :key="i" v-bind="pasteTile(p)" sent @open="opened = p" />
    <PastedSheet :open="opened !== null" :text="opened || ''" @update:open="(o: boolean) => { if (!o) opened = null }" />
  </span>
</template>
