<script setup lang="ts">
// Renommer : le nom va dans Herdr (pane.rename, tab.rename, workspace.rename),
// donc visible partout. Un pane peut revenir à son nom automatique ; un espace
// ou un onglet garde toujours un nom.
const open = computed({
  get: () => Boolean(renameTarget.value || renameSpace.value),
  set: (v) => {
    if (v) return
    renameTarget.value = null
    renameSpace.value = null
  },
})
const pane = computed(() => herdrState.value.panes.find(p => p.id === renameTarget.value))
const value = ref('')
const input = ref<{ inputRef?: HTMLInputElement } | null>(null)
const title = computed(() => (renameSpace.value ? (renameSpace.value.kind === 'tab' ? t('Rename tab') : t('Rename space')) : t('Rename pane')))
const placeholder = computed(() => (renameSpace.value ? (renameSpace.value.kind === 'tab' ? t('Tab name') : t('Space name')) : t('Pane name (empty = automatic name)')))
function focusInput() {
  setTimeout(() => {
    input.value?.inputRef?.focus()
    input.value?.inputRef?.select()
  }, 80)
}
watch(renameTarget, (id) => {
  if (!id) return
  const p = pane.value
  value.value = p ? p.label || paneTitle(p) : ''
  focusInput()
})
watch(renameSpace, (x) => {
  if (!x) return
  value.value = x.label
  focusInput()
})
async function save(label: string) {
  if (renameSpace.value) {
    if (label) await saveSpaceName(label)
    return
  }
  const id = renameTarget.value
  if (!id) return
  try {
    await api('/api/rename', { pane_id: id, label })
    renameTarget.value = null
    toast(label ? t('Renamed') : t('Automatic name restored'))
  } catch (err) { toast((err as Error).message, true) }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="title">
    <form class="rename" @submit.prevent="save(value.trim())">
      <UInput ref="input" v-model="value" maxlength="60" size="xl" class="w-full" :placeholder="placeholder" />
      <div class="rename-actions">
        <UButton v-if="!renameSpace && pane && pane.label" color="neutral" variant="ghost" class="sheet-btn" @click="save('')">{{ t('Reset') }}</UButton>
        <UButton type="submit" color="primary" variant="solid" class="sheet-btn hw-cta" :disabled="Boolean(renameSpace) && !value.trim()">{{ t('Save') }}</UButton>
      </div>
    </form>
  </AppSheet>
</template>
