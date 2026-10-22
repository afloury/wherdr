<script setup lang="ts">
// An agent in wherdr's compact list (app/components/AgentCard.vue, the 2.0
// default): one line with its logo, a task's key, its title, a task's progress
// and its state square. While it waits for you the line opens on its question
// and, when it offers some, the answers (a tap answers).
import { AGENT_ICON } from '~/utils/demoScript'
import type { DemoAgent } from '~/utils/demoScript'

const props = defineProps<{ agent: DemoAgent, selected?: boolean, choices?: readonly string[], hit?: number }>()
const open = computed(() => props.agent.state === 'blocked' && Boolean(props.agent.line || props.choices))
</script>

<template>
  <div class="card compact" :class="[agent.state, { sel: selected, open, 'task-row': agent.tag }]">
    <span class="avatar" :class="agent.agent"><UIcon :name="AGENT_ICON[agent.agent]" /></span>
    <span v-if="agent.tag" class="card-tag">{{ agent.tag }}</span>
    <span class="card-title">{{ agent.name }}</span>
    <span v-if="agent.stats" class="home-task-stats">{{ agent.stats }}</span>
    <span class="card-state" :class="agent.state"><i /></span>
    <div v-if="open" class="card-more">
      <div v-if="agent.line" class="card-preview">{{ agent.line }}</div>
      <div v-if="choices" class="card-choices">
        <button v-for="(c, i) in choices" :key="c" type="button" tabindex="-1" :class="{ hit: hit === i + 1 }">
          <span class="n">{{ i + 1 }}</span><span>{{ c }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
