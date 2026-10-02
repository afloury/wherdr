<script setup lang="ts">
// Attached file (PDF, text, code…): icon by type, name, size. In the input
// field it can be removed; in a sent message a click opens the path menu.
import { attachmentIcon, extensionOf, formatSize, type AttachKind } from '#shared/attachments'

const props = defineProps<{ name: string, size?: number, kind?: AttachKind, uploading?: boolean, removable?: boolean, clickable?: boolean }>()
const emit = defineEmits<{ remove: [], open: [el: HTMLElement] }>()
const icon = computed(() => attachmentIcon(props.name, props.kind))
const ext = computed(() => extensionOf(props.name).slice(0, 6) || (props.kind === 'text' ? 'txt' : ''))
function open(e: Event) {
  if (props.clickable) emit('open', e.currentTarget as HTMLElement)
}
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'" :type="clickable ? 'button' : undefined" class="file-chip"
    :class="{ up: uploading, clickable }" :title="name" @click="open"
  >
    <span class="file-chip-icon">
      <span v-if="uploading" class="spinner" />
      <UIcon v-else :name="icon" />
    </span>
    <span class="file-chip-body">
      <span class="file-chip-name">{{ name }}</span>
      <span class="file-chip-meta">{{ [ext, size ? formatSize(size) : ''].filter(Boolean).join(' · ') }}</span>
    </span>
    <button v-if="removable" type="button" class="file-chip-x" :aria-label="t('Remove')" @click.stop="emit('remove')">
      <UIcon name="i-lucide-x" />
    </button>
  </component>
</template>
