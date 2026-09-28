<script setup lang="ts">
// Confirmation d'une action (fermer un pane, désactiver le verrouillage, installer…).
const open = computed({
  get: () => confirmState.open,
  set: (v) => { if (!v) answerConfirm(false) },
})
</script>

<template>
  <AppSheet v-model:open="open">
    <div class="confirm">
      <p style="white-space: pre-line">{{ confirmState.message }}</p>
      <div class="rename-actions">
        <UButton color="neutral" variant="ghost" class="sheet-btn" @click="answerConfirm(false)">{{ t('Annuler') }}</UButton>
        <UButton :color="confirmState.tone" variant="solid" class="sheet-btn" :class="{ 'hw-cta': confirmState.tone === 'primary' }" @click="answerConfirm(true)">{{ confirmState.action }}</UButton>
      </div>
    </div>
  </AppSheet>
</template>
