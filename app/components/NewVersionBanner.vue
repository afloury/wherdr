<script setup lang="ts">
// "New version available" banner after a redeployment: the app
// keeps working, the user reloads whenever they want.
// (The notice of a newly published image is UpdateBanner, separate.)
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
