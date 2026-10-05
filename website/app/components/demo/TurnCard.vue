<script setup lang="ts">
// "Your turn" (app/components/ChoicesPanel.vue): the agent's question and its
// numbered answers, between the conversation and the field. `picked`: the
// answer being tapped.
defineProps<{ question: string, options: readonly { n: number, title: string, sub: string }[], picked?: number }>()
</script>

<template>
  <div class="choices">
    <p class="eyebrow choices-eyebrow"><i />Your turn</p>
    <p class="choices-q">{{ question }}</p>
    <div class="choices-list">
      <div v-for="o in options" :key="o.n" :class="{ cur: o.n === 1 && !picked, hit: picked === o.n }">
        <span class="n">{{ o.n }}</span>
        <span class="l">{{ o.title }}<small>{{ o.sub }}</small></span>
      </div>
    </div>
  </div>
</template>
