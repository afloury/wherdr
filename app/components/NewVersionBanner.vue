<script setup lang="ts">
// Bandeau « Nouvelle version disponible » après un redéploiement : l'app
// continue de marcher, l'utilisateur recharge quand il veut.
// (L'avis de nouvelle image publiée est UpdateBanner, distinct.)
const busy = ref(false)
function reload() {
  haptic()
  busy.value = true
  applyNewVersion()
}
function later() {
  haptic()
  newVersionDismissed.value = true
}
</script>

<template>
  <div v-if="newVersionReady && !newVersionDismissed" class="new-version" role="status">
    <UIcon name="i-lucide-refresh-cw" />
    <span class="new-version-text">{{ tl('New version available', 'Nouvelle version disponible') }}</span>
    <button type="button" class="new-version-btn primary" :disabled="busy" @click="reload">{{ tl('Reload', 'Recharger') }}</button>
    <button type="button" class="new-version-btn" @click="later">{{ tl('Later', 'Plus tard') }}</button>
  </div>
</template>
