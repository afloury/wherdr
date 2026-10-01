<script setup lang="ts">
// App window: sheet at the bottom of the screen on the phone, centered window
// on a computer (≥ 900 px). Escape or a tap outside closes it.
// `screen`: full-screen view on the phone instead of a sheet (page color,
// safe areas included); unchanged on a computer. The `footer` slot stays
// pinned under the scrolling content (above the home bar or the keyboard).
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ title?: string, tall?: boolean, wide?: boolean, full?: boolean, screen?: boolean }>()
const emit = defineEmits<{ closed: [] }>()
watch(open, (v, old) => { if (old && !v) emit('closed') })
const ui = computed(() => ({
  overlay: `hw-scrim${props.screen ? ' screen' : ''}`,
  content: `hw-sheet${props.tall ? ' tall' : ''}${props.wide ? ' wide' : ''}${props.full ? ' full' : ''}${props.screen ? ' screen' : ''}`,
  header: props.title ? 'hw-sheet-head' : 'hidden',
  title: 'hw-sheet-title',
  body: 'hw-sheet-body',
  footer: 'hw-sheet-foot',
  close: 'hw-sheet-close',
}))
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="ui" :close="title ? { color: 'neutral', variant: 'ghost' } : false">
    <template #body>
      <slot />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UModal>
</template>
