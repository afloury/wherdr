<script setup lang="ts">
// Attached file (PDF, text, code…) in a sent message: icon by type, name,
// size; a click opens the path menu. In the input field: AttachTile.
import { attachmentIcon, extensionOf, formatSize, type AttachKind } from '#shared/attachments'

const props = defineProps<{ name: string, size?: number, kind?: AttachKind, clickable?: boolean }>()
const emit = defineEmits<{ open: [el: HTMLElement] }>()
const icon = computed(() => attachmentIcon(props.name, props.kind))
const ext = computed(() => extensionOf(props.name).slice(0, 6) || (props.kind === 'text' ? 'txt' : ''))
function open(e: Event) {
  if (props.clickable) emit('open', e.currentTarget as HTMLElement)
}
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'" :type="clickable ? 'button' : undefined" class="file-chip"
    :class="{ clickable }" :title="name" @click="open"
  >
    <span class="file-chip-icon">
      <UIcon :name="icon" />
    </span>
    <span class="file-chip-body">
      <span class="file-chip-name">{{ name }}</span>
      <span class="file-chip-meta">{{ [ext, size ? formatSize(size) : ''].filter(Boolean).join(' · ') }}</span>
    </span>
  </component>
</template>
