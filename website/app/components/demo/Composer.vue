<script setup lang="ts">
// wherdr's message field (app/components/Composer.vue, UChatPrompt): text or
// placeholder, + button, model and effort pickers, keyboard hints on a
// computer, send button. `focus`: the field has the focus, so the gliding
// ring and its halo turn (the app's default "Halo" setting) in the agent's
// color. `stop`: the agent works and the field is empty, so send becomes stop.
// `menu`: the effort picker's list, open.
import { KIND_LABEL } from '~/utils/demoScript'
import type { AgentKind } from '~/utils/demoScript'

const props = defineProps<{
  agent: AgentKind
  text?: string
  /** Defaults to the app's "Message to <agent>…". */
  placeholder?: string
  model: string
  effort: string
  desktop?: boolean
  focus?: boolean
  stop?: boolean
  menu?: readonly string[]
}>()
const stopping = computed(() => props.stop && !props.text)
</script>

<template>
  <div class="composer" :data-agent="agent">
    <div class="prompt" :class="{ focus }">
      <div class="prompt-input">
        <template v-if="text">{{ text }}<i v-if="focus" class="caret" /></template>
        <span v-else class="ph">{{ placeholder ?? `Message to ${KIND_LABEL[agent]}…` }}</span>
      </div>
      <div class="prompt-foot">
        <span class="prompt-plus"><UIcon name="i-lucide-plus" /></span>
        <span class="model-pick">{{ model }}<UIcon name="i-lucide-chevron-down" class="model-caret" /></span>
        <span class="model-pick effort-pick" :class="{ open: menu }">
          {{ effort }}<UIcon name="i-lucide-chevron-down" class="model-caret" />
          <span v-if="menu" class="model-menu demo-rise">
            <span v-for="m in menu" :key="m" :class="{ on: m === effort }">{{ m }}<UIcon v-if="m === effort" name="i-lucide-check" /></span>
          </span>
        </span>
        <span v-if="desktop && !stopping" class="prompt-hint"><kbd>↵</kbd> send <span class="sep">·</span><kbd>⇧</kbd><kbd>↵</kbd> new line</span>
        <span v-else-if="desktop" class="prompt-hint"><kbd>Esc</kbd> stop</span>
        <span class="prompt-send" :class="{ stop: stopping, off: !text && !stopping }"><UIcon :name="stopping ? 'i-herdr-stop' : 'i-lucide-arrow-up'" /></span>
      </div>
    </div>
  </div>
</template>
