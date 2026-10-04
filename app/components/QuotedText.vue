<script setup lang="ts">
// Text of a user message: the "> " lines (questions and passages quoted, see
// utils/questionReply.ts) shown as quotes, each answer below its quote.
import { quoteSegments } from '~/utils/questionReply'

const props = defineProps<{ text: string }>()
const segments = computed(() => quoteSegments(props.text))
</script>

<template>
  <template v-for="(s, i) in segments" :key="i">
    <span v-if="s.quote" class="msg-q">{{ s.text }}</span>
    <template v-else>{{ s.text }}</template>
  </template>
</template>
