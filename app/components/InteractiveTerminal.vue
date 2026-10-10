<script setup lang="ts">
// The pane's real terminal, fitted with the same size lease as Terminal view.
// Escape belongs to the agent. Closing this window only releases the lease.
const props = defineProps<{ paneId: string }>()
const emit = defineEmits<{ close: [] }>()
const banner = shallowRef<Banner | null>(null)
const ctl = createTerminal(props.paneId, {
  setBanner: b => { banner.value = b },
  hasBanner: () => Boolean(banner.value),
  fill: () => true,
})
watch(pageVisible, v => ctl.setVisible(v))
</script>

<template>
  <section class="interactive-terminal" role="region" :aria-label="tl('Interactive terminal', 'Terminal interactif')" @keydown.stop>
    <header class="interactive-terminal-head">
      <span><UIcon name="i-lucide-square-terminal" />{{ tl('Interactive terminal', 'Terminal interactif') }}</span>
      <UButton icon="i-lucide-x" color="neutral" variant="ghost" :aria-label="tl('Close terminal window', 'Fermer la fenêtre terminal')" @click="emit('close')" />
    </header>
    <p class="interactive-terminal-note">{{ tl('Live agent screen · closes when the message field returns', 'Écran réel de l’agent · se ferme au retour du champ libre') }}</p>
    <div v-if="banner" class="term-banner">
      <span>{{ banner.text }}</span>
      <UButton size="xs" color="warning" variant="outline" @click="banner.fn()">{{ banner.btn }}</UButton>
    </div>
    <TerminalView :ctl="ctl" />
    <Keybar :ctl="ctl" all-digits />
  </section>
</template>
