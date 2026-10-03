<script setup lang="ts">
// Folder field: button opening the browser (`browse`), chips of recent
// folders (the first 6, "+N" shows the others; past 6, a field filters them
// by name and Enter takes the first match); `clearable` adds a cross that
// empties the field (value ''). `kinds` marks herdr-projects folders (project
// or thread folder, path → kind): a marker on the chip and in the field, and a
// project folder sharing its name with another chip is labelled "<name> · project".
import type { ProjectFolderKind } from '#shared/projectFolders'

const FOLDED = 6
const model = defineModel<string | null>({ required: true })
const props = defineProps<{ recents: string[], kinds?: Record<string, ProjectFolderKind>, placeholder?: string, clearable?: boolean }>()
const emit = defineEmits<{ browse: [] }>()
const query = ref('')
const expanded = ref(false)
const hidden = computed(() => props.recents.length - FOLDED)
const labels = computed(() => {
  const names = folderLabels(props.recents.map(d => shortPath(d)), props.recents.map(d => props.kinds?.[d]), tl(' · project', ' · projet'))
  return new Map(props.recents.map((d, i) => [d, names[i]!]))
})
// Only while the filter field shows: no invisible filter.
const filtering = computed(() => hidden.value > 0 && Boolean(query.value.trim()))
const matches = computed(() => (filtering.value ? filterByName(props.recents, query.value, d => labels.value.get(d)!) : props.recents))
const shown = computed(() => (filtering.value || expanded.value ? matches.value : matches.value.slice(0, FOLDED)))
const kindOf = (d: string | null | undefined) => (d && props.kinds?.[d]) || undefined
const chipTitle = (d: string) => {
  const k = kindOf(d)
  return k ? `${shortPath(d)}\n${projectFolderHint(k)}` : shortPath(d)
}
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
      <ProjectFolderMark v-if="kindOf(model)" :kind="kindOf(model)!" />
      <UIcon name="i-lucide-chevron-right" class="chev" />
    </button>
    <button v-if="clearable && model" type="button" class="dir-clear" :aria-label="tl('Clear', 'Vider')" :title="tl('Clear', 'Vider')" @click="model = ''">
      <UIcon name="i-lucide-x" />
    </button>
  </div>
  <NameFilter v-if="hidden > 0" v-model="query" class="recent-filter" :label="tl('Filter recent folders', 'Filtrer les dossiers récents')" @pick="pickFirst" />
  <div v-if="recents.length" class="chips">
    <button v-for="d in shown" :key="d" type="button" :title="chipTitle(d)" :class="{ on: d === model, project: kindOf(d) }" @click="model = d">
      <ProjectFolderMark v-if="kindOf(d)" :kind="kindOf(d)!" icon />{{ labels.get(d) }}
    </button>
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
