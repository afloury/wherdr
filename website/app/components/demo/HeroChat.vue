<script setup lang="ts">
// The hero's conversation at a step of HERO, the same on the phone and in the
// window: the previous turn, the message (queued, then sent), omp's reply
// header, its console filling up (ring gliding while a call runs) with its
// running step below, the answer typed in encrypted text. "Your turn" and the
// field are in HeroBottom.
import { ANSWER, PREVIOUS, actionsAt, ompStepAt, MESSAGE } from '~/utils/heroDemo'

defineProps<{ step: number, loop: number }>()
</script>

<template>
  <div class="chat-list">
    <DemoReply :paras="[PREVIOUS]" agent="omp" />
    <DemoTurnEnd text="✓ 1 min · 2 actions" />
    <DemoUserMessage v-if="step >= 2" :key="`u${loop}`" :text="MESSAGE" :phase="step < 3 ? 'queued' : 'sent'" />
    <div v-if="step >= 4" :key="`w${loop}`" class="msg-who omp"><UIcon name="i-herdr-omp" /><span>omp</span></div>
    <DemoConsole v-if="step >= 4" :key="`c${loop}`" :actions="actionsAt(step)" :live="step < 8" />
    <DemoReply v-if="step >= 8" :key="`a${loop}`" :paras="[ANSWER]" agent="omp" typing />
    <DemoOmpStatus v-if="ompStepAt(step)" :key="`s${loop}`" :text="ompStepAt(step)!" />
  </div>
</template>
