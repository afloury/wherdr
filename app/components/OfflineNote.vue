<script setup lang="ts">
// Barre « hors ligne » dans le flux de la vue (jamais par-dessus l'en-tête) :
// dernier état connu ou lecture hors ligne, sinon connexion perdue, avec
// « Réessayer » tant que le serveur est injoignable.
const props = defineProps<{ label?: string, at?: number | null, dateStyle?: 'short' | 'medium' }>()
const text = computed(() => {
  if (props.label) return props.at ? `${props.label} · ${new Date(props.at).toLocaleString(language, { dateStyle: props.dateStyle || 'short', timeStyle: 'short' })}` : props.label
  return hostLabel.value
    ? tl(`Connexion à ${hostLabel.value} perdue — reconnexion…`, `Lost connection to ${hostLabel.value} — reconnecting…`)
    : tl('Connexion au serveur perdue — reconnexion…', 'Lost connection to the server — reconnecting…')
})
</script>

<template>
  <div class="offline-note" role="status">
    <UIcon name="i-lucide-wifi-off" />
    <span class="offline-note-text">{{ text }}</span>
    <button v-if="netDown && !locked" type="button" class="offline-retry" @click="retryEvents">{{ t('Réessayer') }}</button>
  </div>
</template>
