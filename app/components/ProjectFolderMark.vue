<script setup lang="ts">
// Marker of a herdr-projects folder (project or thread folder) in the folder
// pickers: an icon (`icon`, recent-folder chips) or a small label (field,
// browser), with a tooltip saying it is not the repository.
import type { ProjectFolderKind } from '#shared/projectFolders'

const props = defineProps<{ kind: ProjectFolderKind, icon?: boolean }>()
const hint = computed(() => projectFolderHint(props.kind))
const label = computed(() => (props.kind === 'project' ? tl('project', 'projet') : 'thread'))
</script>

<template>
  <UIcon v-if="icon" name="i-lucide-folder-kanban" class="project-mark-icon" :title="hint" :aria-label="hint" role="img" />
  <span v-else class="project-mark" :title="hint">{{ label }}<span class="sr-only">. {{ hint }}</span></span>
</template>
