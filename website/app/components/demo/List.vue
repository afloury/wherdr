<script setup lang="ts">
// wherdr's agent list below its title (app/components/HomeView.vue), in the
// 2.0 compact list: counters and quotas on thin strips, then the agents by
// state (your turn, working, ready), one line each. `choicesFor` names the agent whose open line offers
// `choices`; `hit` is the answer tapped.
import { listGroups } from '~/utils/demoScript'
import type { DemoAgent } from '~/utils/demoScript'

const props = defineProps<{
  agents: readonly DemoAgent[]
  active?: string
  choices?: readonly string[]
  choicesFor?: string
  hit?: number
}>()

const groups = computed(() => listGroups(props.agents))
</script>

<template>
  <div class="home-list">
    <DemoCounts :agents="agents" />
    <DemoQuotas />
    <div v-for="g in groups" :key="g.key" class="agent-group" :class="g.key">
      <h4 class="group-title"><span>{{ g.title }}</span><span class="count">{{ g.list.length }}</span></h4>
      <div class="card-list">
        <DemoAgentCard
          v-for="a in g.list" :key="a.name" :agent="a" :selected="a.name === active"
          :choices="choicesFor === a.name ? choices : undefined" :hit="hit"
        />
      </div>
    </div>
  </div>
</template>
