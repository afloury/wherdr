<script setup lang="ts">
// App window: sheet at the bottom of the screen on the phone, centered window
// on a computer (≥ 900 px). Escape or a tap outside closes it.
const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ title?: string, tall?: boolean, wide?: boolean, full?: boolean }>()
const emit = defineEmits<{ closed: [] }>()
watch(open, (v, old) => { if (old && !v) emit('closed') })
const ui = computed(() => ({
  overlay: 'hw-scrim',
  content: `hw-sheet${props.tall ? ' tall' : ''}${props.wide ? ' wide' : ''}${props.full ? ' full' : ''}`,
  header: props.title ? 'hw-sheet-head' : 'hidden',
  title: 'hw-sheet-title',
  body: 'hw-sheet-body',
  close: 'hw-sheet-close',
}))
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="ui" :close="title ? { color: 'neutral', variant: 'ghost' } : false">
    <template #body>
      <slot />
    </template>
  </UModal>
</template>
