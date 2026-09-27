<script setup lang="ts">
// État d'un agent, à la manière de la liste « agents » de herdr.dev :
// point de couleur + ligne mono « working · claude » (+ « · opus 5.5 » avec `model`).
import type { Pane } from '#shared/types'

defineProps<{ pane: Pane | null | undefined, kind?: boolean, model?: boolean }>()
</script>

<template>
  <span v-if="pane" class="pill" :class="statusKey(pane)"><i />{{ statusLabel(pane) }}<template v-if="kind && pane.agent"><span class="sep">·</span><span class="pill-kind" :class="pane.agent">{{ pane.agent }}</span></template><template v-if="model && pane.model"><span class="sep">·</span><span class="pill-model">{{ pane.model.label }}</span><span v-if="pane.model.effort" class="pill-effort">{{ pane.model.effort }}</span></template></span>
  <span v-else class="pill unknown"><i />{{ t('Fermé') }}</span>
</template>
