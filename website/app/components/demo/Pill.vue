<script setup lang="ts">
// An agent's state as the app writes it (app/components/StatusPill.vue):
// square + "working", then "· claude" (kind) or "· opus 5.5 high" (model).
import { STATE_LABEL } from '~/utils/demoScript'
import type { AgentState } from '~/utils/demoScript'

defineProps<{ state: AgentState, kind?: string, model?: string, effort?: string, label?: string }>()
</script>

<template>
  <span class="pill" :class="state"><i />{{ label ?? STATE_LABEL[state] }}<template v-if="kind"><span class="sep">·</span><span class="pill-kind">{{ kind }}</span></template><template v-if="model"><span class="sep">·</span><span class="pill-model">{{ model }}</span><span v-if="effort" class="pill-effort">{{ effort }}</span></template></span>
</template>
