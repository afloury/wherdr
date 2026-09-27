<script setup lang="ts">
// Bouton « … » d'un espace, d'un onglet ou d'un pane : menu déroulant sur
// ordinateur, feuille sur téléphone. Les entrées sont calculées à l'ouverture.
const props = defineProps<{ items: () => MenuItem[], title?: string, label?: string, size?: 'sm' | 'md' | 'lg' }>()
const dropdown = ref<ReturnType<typeof toDropdown>>([])
function onOpen(o: boolean) {
  if (o) dropdown.value = toDropdown(props.items())
}
function openSheet() {
  haptic()
  openMenu(props.items(), props.title)
}
</script>

<template>
  <UDropdownMenu v-if="desk" :items="dropdown" :content="{ align: 'end', sideOffset: 6 }" :ui="{ content: 'hw-dropdown' }" @update:open="onOpen">
    <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" :size="size || 'md'" class="icon-btn space-menu" :aria-label="label || t('Options')" @click.stop />
  </UDropdownMenu>
  <UButton v-else icon="i-lucide-ellipsis" color="neutral" variant="ghost" :size="size || 'md'" class="icon-btn space-menu" :aria-label="label || t('Options')" @click.stop="openSheet" />
</template>
