<script setup lang="ts">
import { formatTokens, tokenCount } from '~/utils/tokenCount'
const props = defineProps<{ value: number | string | null | undefined }>()
const expanded = ref(false)
const exact = computed(() => tokenCount(props.value))
watch(() => props.value, () => { expanded.value = false })
</script>

<template>
  <span v-if="exact === null">{{ formatTokens(value) }}</span>
  <span v-else class="token-count">
    <button type="button" :title="String(exact)" :aria-expanded="expanded" :aria-label="tl(`Show exact token count: ${exact}`, `Afficher le nombre exact de tokens : ${exact}`)" @click="expanded = !expanded">{{ formatTokens(value) }}</button>
    <span v-if="expanded" class="token-count-exact"> ({{ exact }})</span>
  </span>
</template>

<style scoped>
button { font: inherit; color: inherit; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
button:focus { outline: none; }
button:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; border-radius: 0; }
.token-count-exact { font-variant-numeric: tabular-nums; }
</style>
