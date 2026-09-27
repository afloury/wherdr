<script setup lang="ts">
import type { Meter } from '~/utils/meters'
// Résultat d'une commande locale de l'agent (/context, /usage…). Panneau de
// réglages de Claude Code : ses onglets (pilotés par ← → dans le terminal) et
// les jauges d'utilisation en barres.
const open = computed({
  get: () => commandResult.open,
  set: (v) => { if (!v) closeCommandResult() },
})
const parsed = computed(() => (commandResult.text === null ? null : parseMeters(commandResult.text)))
const level = (m: Meter) => { const u = usedOf(m); return u >= 85 ? 'hi' : u >= 60 ? 'mid' : 'lo' }
</script>

<template>
  <AppSheet v-model:open="open" wide>
    <div class="menu">
      <p class="eyebrow menu-head"><span>❯ {{ commandResult.cmd }}</span></p>
      <div v-if="commandResult.tab" class="cmd-tabs" role="tablist">
        <button
          v-for="tb in SETTINGS_TABS" :key="tb" type="button" role="tab" :aria-selected="tb === commandResult.tab"
          :class="{ on: tb === commandResult.tab }" @click="switchCommandTab(tb)"
        >
          {{ tb }}
        </button>
      </div>
      <div v-if="parsed && parsed.meters.length" class="meters">
        <div v-for="m in parsed.meters" :key="m.label" class="meter" :class="level(m)">
          <div class="meter-top">
            <span class="meter-label">{{ m.label }}</span>
            <b>{{ m.pct }}<small>% {{ m.kind === 'left' ? t('restant') : t('utilisé') }}</small></b>
          </div>
          <div class="meter-bar"><i :style="{ width: `${m.pct}%` }" /></div>
          <div v-if="m.reset" class="meter-reset">{{ t('Réinitialisation') }} · {{ m.reset }}</div>
        </div>
      </div>
      <pre v-if="!parsed || parsed.rest" class="screen"><span v-if="!parsed" class="spinner" /><template v-else>{{ parsed.rest }}</template></pre>
    </div>
  </AppSheet>
</template>
