<script setup lang="ts">
// Text of a task, inline: URLs and Markdown links are plain links.
import { textParts } from '#shared/projectBoard'

const props = defineProps<{ text: string }>()
const parts = computed(() => textParts(props.text))
</script>

<template>
  <template v-for="(x, i) in parts" :key="i"><a v-if="x.href" class="pp-tlink" :href="x.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ x.text }}</a><template v-else>{{ x.text }}</template></template>
</template>
