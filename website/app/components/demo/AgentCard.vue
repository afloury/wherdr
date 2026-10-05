<script setup lang="ts">
// An agent in wherdr's list (app/components/AgentCard.vue): logo, name, role
// tag and state pill with the model, folder, last line of the conversation,
// and the agent's answers when it waits for one (a tap answers).
import { AGENT_ICON } from '~/utils/demoScript'
import type { DemoAgent } from '~/utils/demoScript'

defineProps<{ agent: DemoAgent, selected?: boolean, choices?: readonly string[], hit?: number }>()
</script>

<template>
  <div class="card" :class="[agent.state, { sel: selected }]">
    <div class="avatar" :class="agent.agent"><UIcon :name="AGENT_ICON[agent.agent]" /></div>
    <div class="card-main">
      <div class="card-title">{{ agent.name }}</div>
      <div class="card-meta">
        <span v-if="agent.tag" class="card-tag">{{ agent.tag }}</span>
        <DemoPill :state="agent.state" :model="agent.model" :effort="agent.effort" />
      </div>
      <div v-if="agent.where" class="card-where">{{ agent.where }}</div>
    </div>
    <div class="card-preview">{{ agent.line }}</div>
    <div v-if="choices" class="card-choices">
      <button v-for="(c, i) in choices" :key="c" type="button" tabindex="-1" :class="{ hit: hit === i + 1 }">
        <span class="n">{{ i + 1 }}</span><span>{{ c }}</span>
      </button>
    </div>
  </div>
</template>
