<script setup lang="ts">
// Claude and Codex quotas under the counters (app/components/QuotaStrip.vue),
// as the compact list shows them: what is left of each window, and its bar.
import { AGENT_ICON } from '~/utils/demoScript'

const rows = [
  { agent: 'claude', windows: [['5 h', 66], ['week', 79]] },
  { agent: 'codex', windows: [['5 h', 88], ['week', 54]] },
] as const
</script>

<template>
  <div class="quotas">
    <div v-for="r in rows" :key="r.agent" class="quota-row">
      <div class="quota-who"><span class="avatar" :class="r.agent"><UIcon :name="AGENT_ICON[r.agent]" /></span></div>
      <div v-for="[label, left] in r.windows" :key="label" class="quota">
        <div class="quota-top"><span class="quota-label">{{ label }}</span><b>{{ left }}<small>%</small></b></div>
        <div class="quota-bar"><i :style="{ width: `${left}%` }" /></div>
      </div>
    </div>
  </div>
</template>
