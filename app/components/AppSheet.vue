<script setup lang="ts">
// Fenêtre de l'app : feuille en bas de l'écran sur téléphone, fenêtre centrée
// sur ordinateur (≥ 900 px). Échap ou un tap à côté la ferme.
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
