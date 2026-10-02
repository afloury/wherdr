<script setup lang="ts">
// Folder field: button opening the browser (`browse`), chips of recent
// folders (the first 6, "+N" shows the others; past 6, a field filters them
// by name and Enter takes the first match); `clearable` adds a cross that
// empties the field (value '').
const FOLDED = 6
const model = defineModel<string | null>({ required: true })
const props = defineProps<{ recents: string[], placeholder?: string, clearable?: boolean }>()
const emit = defineEmits<{ browse: [] }>()
const query = ref('')
const expanded = ref(false)
const hidden = computed(() => props.recents.length - FOLDED)
const labels = computed(() => {
  const names = folderLabels(props.recents.map(d => shortPath(d)))
  return new Map(props.recents.map((d, i) => [d, names[i]!]))
})
// Only while the filter field shows: no invisible filter.
const filtering = computed(() => hidden.value > 0 && Boolean(query.value.trim()))
const matches = computed(() => (filtering.value ? filterByName(props.recents, query.value, d => labels.value.get(d)!) : props.recents))
const shown = computed(() => (filtering.value || expanded.value ? matches.value : matches.value.slice(0, FOLDED)))
const moreLabel = computed(() => tl(`+${hidden.value} more`, `+${hidden.value} de plus`))
function pickFirst() {
  if (matches.value[0]) model.value = matches.value[0]
}
</script>

<template>
  <div class="dir-field">
    <button type="button" class="dir-pick" :class="{ unset: !model }" @click="emit('browse')">
      <UIcon name="i-lucide-folder" />
      <span>{{ model ? ltr(shortPath(model)) : placeholder }}</span>
      <UIcon name="i-lucide-chevron-right" class="chev" />
    </button>
    <button v-if="clearable && model" type="button" class="dir-clear" :aria-label="tl('Clear', 'Vider')" :title="tl('Clear', 'Vider')" @click="model = ''">
      <UIcon name="i-lucide-x" />
    </button>
  </div>
  <NameFilter v-if="hidden > 0" v-model="query" class="recent-filter" :label="tl('Filter recent folders', 'Filtrer les dossiers récents')" @pick="pickFirst" />
  <div v-if="recents.length" class="chips">
    <button v-for="d in shown" :key="d" type="button" :title="shortPath(d)" :class="{ on: d === model }" @click="model = d">{{ labels.get(d) }}</button>
    <button
      v-if="hidden > 0 && !filtering" type="button" class="chips-more" :aria-expanded="expanded"
      :aria-label="moreLabel" :title="expanded ? tl('Show fewer', 'Afficher moins') : moreLabel" @click="expanded = !expanded"
    >
      <UIcon v-if="expanded" name="i-lucide-chevron-up" />
      <template v-else>+{{ hidden }}</template>
    </button>
    <span v-if="filtering && !matches.length" class="chips-none" role="status">{{ tl('No matching folder', 'Aucun dossier correspondant') }}</span>
  </div>
</template>
