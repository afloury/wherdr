<script setup lang="ts">
// "Offline" bar in the view's flow (never over the header):
// last known state or offline reading, otherwise connection lost, with
// "Retry" while the server is unreachable.
const props = defineProps<{ label?: string, at?: number | null, dateStyle?: 'short' | 'medium' }>()
const text = computed(() => {
  if (props.label) return props.at ? `${props.label} · ${new Date(props.at).toLocaleString(language, { dateStyle: props.dateStyle || 'short', timeStyle: 'short' })}` : props.label
  return hostLabel.value
    ? tl(`Lost connection to ${hostLabel.value} — reconnecting…`, `Connexion à ${hostLabel.value} perdue — reconnexion…`)
    : tl('Lost connection to the server — reconnecting…', 'Connexion au serveur perdue — reconnexion…')
})
</script>

<template>
  <div class="offline-note" role="status">
    <UIcon name="i-lucide-wifi-off" />
    <span class="offline-note-text">{{ text }}</span>
    <button v-if="netDown && !locked" type="button" class="offline-retry" @click="retryEvents">{{ t('Retry') }}</button>
  </div>
</template>
