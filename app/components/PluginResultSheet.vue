<script setup lang="ts">
import { doctorLevel } from '#shared/projectsActions'

// Résultat d'une action de plugin qui doit rester lisible : « Check setup »
// (ce que wherdr utilise, puis la sortie de doctor) et « Configure ».
const open = computed({ get: () => pluginResultState.open, set: (v) => { pluginResultState.open = v } })
const r = computed(() => pluginResultState.result)
const setupLabel = (key: string) => ({
  version: tl('Version du plugin', 'Plugin version'),
  binary: tl('Binaire', 'Binary'),
  home: 'HOME',
  config: tl('Config Herdr', 'Herdr config'),
}[key] || key)
const lines = computed(() => String(r.value?.full || r.value?.output || '').split('\n')
  .map(text => ({ text, level: doctorLevel(text) })))
const status = computed(() => {
  const s = r.value?.status
  if (s === 'failed') return { cls: 'fail', text: r.value?.setup ? tl('Des contrôles ont échoué', 'Some checks failed') : tl('Échec', 'Failed') }
  if (s === 'running') return { cls: 'warn', text: tl('Continue en arrière-plan', 'Still running in the background') }
  return { cls: 'ok', text: r.value?.setup ? tl('Tous les contrôles sont passés', 'All checks passed') : tl('Terminé', 'Done') }
})
</script>

<template>
  <AppSheet v-model:open="open" :title="pluginResultState.title" :wide="Boolean(r?.setup)">
    <div class="plugin-result">
      <div v-if="pluginResultState.reload" class="plugin-input-note reload">
        <UIcon name="i-lucide-refresh-cw" />
        <div>
          <strong>{{ tl('Recharge la config du client Herdr', 'Reload the Herdr client config') }}</strong>
          <p>{{ tl('Dans le terminal Herdr : ', 'In the Herdr terminal: ') }}<kbd>prefix</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd>. {{ tl('Sans ça, la barre latérale et la touche du panneau Projects ne changent pas.', 'Until then, the sidebar and the Projects popup key do not change.') }}</p>
        </div>
      </div>

      <dl v-if="r?.setup" class="plugin-setup">
        <template v-for="row in r.setup" :key="row.key">
          <dt>{{ setupLabel(row.key) }}</dt>
          <dd :class="{ warn: row.warn }">
            {{ row.value }}
            <span v-if="row.warn && row.key === 'binary'" class="plugin-setup-why">{{ tl('hors de ce HOME : environnement différent ?', 'outside this HOME: different environment?') }}</span>
          </dd>
        </template>
      </dl>

      <p class="plugin-result-status" :class="status.cls">
        {{ status.text }}<template v-if="r?.exitCode"> · {{ tl('code', 'exit') }} {{ r.exitCode }}</template>
      </p>
      <pre v-if="lines.some(l => l.text)" class="plugin-result-out"><span v-for="(l, i) in lines" :key="i" :class="l.level">{{ l.text }}
</span></pre>

      <div class="rename-actions">
        <UButton color="primary" variant="solid" class="sheet-btn hw-cta" @click="open = false">{{ tl('Fermer', 'Close') }}</UButton>
      </div>
    </div>
  </AppSheet>
</template>
