<script setup lang="ts">
// Plain text whose links open in a new tab under a short name ("PR #484").
import { textParts } from '~/utils/blockNotice'

const props = defineProps<{ text: string }>()
const parts = computed(() => textParts(props.text))
</script>

<template>
  <template v-for="(p, i) in parts" :key="i">
    <a v-if="'href' in p" class="linked-text-link" :href="p.href" :title="p.href" target="_blank" rel="noopener noreferrer" @click.stop>{{ p.text }}</a>
    <template v-else>{{ p.text }}</template>
  </template>
</template>
