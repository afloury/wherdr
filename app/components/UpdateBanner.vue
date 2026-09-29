<script setup lang="ts">
// Bandeau « wherdr X.Y.Z est disponible » : lien vers les notes de version et
// commande de mise à jour selon le mode d'installation (Docker, build local, sans Docker).
import type { UpdateInfo } from '#shared/updates'

const props = defineProps<{ info: UpdateInfo, dismissible?: boolean }>()

async function copy() {
  haptic()
  try {
    await navigator.clipboard.writeText(props.info.command)
    toast(t('Commande copiée : colle-la dans un terminal du serveur, dans le dossier de wherdr.'))
  } catch { toast(t('Copie impossible'), true) }
}
</script>

<template>
  <div class="update-banner">
    <UIcon name="i-lucide-circle-arrow-up" class="update-banner-icon" />
    <div class="update-banner-body">
      <p>{{ tl(`wherdr ${info.latest} est disponible`, `wherdr ${info.latest} is available`) }}<small>{{ tl(`Version installée : ${info.current}`, `Installed: ${info.current}`) }}</small></p>
      <code>{{ info.command }}</code>
      <small v-if="info.mode === 'native'">{{ t('Puis relance wherdr.') }}</small>
    </div>
    <div class="update-banner-actions">
      <UButton v-if="info.url" size="sm" color="neutral" variant="ghost" icon="i-lucide-external-link" :to="info.url" target="_blank" rel="noopener noreferrer">{{ t('Notes') }}</UButton>
      <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-copy" @click="copy">{{ t('Copier la commande') }}</UButton>
      <UButton v-if="dismissible" size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('Masquer jusqu’à la version suivante')" @click="dismissUpdate" />
    </div>
  </div>
</template>
