<script setup lang="ts">
// Result of a plugin action that must stay readable (its output).
const open = computed({ get: () => pluginResultState.open, set: (v) => { pluginResultState.open = v } })
const r = computed(() => pluginResultState.result)
const lines = computed(() => String(r.value?.full || r.value?.output || '').split('\n')
  .map(text => ({ text, level: '' })))
const status = computed(() => {
  const s = r.value?.status
  if (s === 'failed') return { cls: 'fail', text: tl('Failed', 'Échec') }
  if (s === 'running') return { cls: 'warn', text: tl('Still running in the background', 'Continue en arrière-plan') }
  return { cls: 'ok', text: tl('Done', 'Terminé') }
})
</script>

<template>
  <AppSheet v-model:open="open" :title="pluginResultState.title" >
    <div class="plugin-result">
      <div v-if="pluginResultState.reload" class="plugin-input-note reload">
        <UIcon name="i-lucide-refresh-cw" />
        <div>
          <strong>{{ tl('Reload the Herdr client config', 'Recharge la config du client Herdr') }}</strong>
          <p>{{ tl('In the Herdr terminal: ', 'Dans le terminal Herdr : ') }}<kbd>prefix</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>. {{ tl('Until then, the sidebar and the Projects popup key do not change.', 'Sans ça, la barre latérale et la touche du panneau Projects ne changent pas.') }}</p>
        </div>
      </div>

      <p class="plugin-result-status" :class="status.cls">
        {{ status.text }}<template v-if="r?.exitCode"> · {{ tl('exit', 'code') }} {{ r.exitCode }}</template>
      </p>
      <pre v-if="lines.some(l => l.text)" class="plugin-result-out"><span v-for="(l, i) in lines" :key="i" :class="l.level">{{ l.text }}
</span></pre>
    </div>
    <template #footer>
      <div class="rename-actions">
        <UButton color="primary" variant="solid" class="sheet-btn hw-cta" @click="open = false">{{ tl('Close', 'Fermer') }}</UButton>
      </div>
    </template>
  </AppSheet>
</template>
