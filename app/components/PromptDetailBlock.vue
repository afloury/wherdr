<script setup lang="ts">
// What the permission allows: tool, description, file and full command (or
// diff). Long: collapsed to a few lines, scrollable, expandable.
import type { PromptDetail } from '#shared/types'

const props = defineProps<{ detail: PromptDetail }>()
const COLLAPSED_LINES = 6
const open = ref(false)
watch(() => props.detail.command, () => { open.value = false })

const lines = computed(() => (props.detail.command || '').split('\n'))
// Collapsed only if worth it (at least three hidden lines).
const long = computed(() => lines.value.length > COLLAPSED_LINES + 2 || (props.detail.command || '').length > 800)
const stats = computed(() => detailStats(props.detail))
</script>

<template>
  <div class="prompt-detail" :class="{ file: detail.file }">
    <p class="prompt-detail-head">
      <span class="prompt-detail-tool">{{ detail.tool }}</span>
      <span v-if="detail.description" class="prompt-detail-desc">{{ detail.description }}</span>
    </p>
    <p v-if="detail.file" class="prompt-detail-file">
      <UIcon name="i-lucide-file-pen" /><span class="path">{{ detail.file }}</span>
      <span v-if="stats" class="prompt-detail-stats"><span v-if="detail.added" class="add">+{{ detail.added }}</span><span v-if="detail.removed" class="del">−{{ detail.removed }}</span></span>
    </p>
    <pre v-if="detail.command" class="prompt-detail-code" :class="{ collapsed: long && !open }"><code><span
      v-for="(l, i) in lines" :key="i" :class="diffKind(l, Boolean(detail.file))"
    >{{ l }}</span></code></pre>
    <p v-if="detail.truncated" class="prompt-detail-note">
      {{ t('Trop long : seul le début est affiché. Le terminal montre la suite.') }}
    </p>
    <button v-if="long" type="button" class="prompt-detail-more" @click="open = !open">
      <UIcon :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" />
      {{ open ? t('Réduire') : tl(`Tout afficher (${lines.length} lignes)`, `Show all (${lines.length} lines)`) }}
    </button>
  </div>
</template>
