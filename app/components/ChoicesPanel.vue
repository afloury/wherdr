<script setup lang="ts">
// Invite bloquante de l'agent ouvert : question + options en gros boutons.
import type { Choices } from '#shared/types'

const props = defineProps<{ paneId: string, prompt: Choices }>()
const busy = ref(false)
watch(() => props.prompt, () => { busy.value = false })

async function pick(i: number, label: string) {
  busy.value = true
  if (!(await choose(props.paneId, i, label))) busy.value = false
}
</script>

<template>
  <div class="choices">
    <p class="eyebrow choices-eyebrow"><i />{{ t('À toi') }}</p>
    <PromptDetailBlock v-if="prompt.detail" :detail="prompt.detail" />
    <p v-if="prompt.question" class="choices-q">{{ prompt.question }}</p>
    <div class="choices-list">
      <button
        v-for="(o, i) in prompt.options" :key="i" type="button" :class="{ cur: i === prompt.cursor }"
        :disabled="busy || !eventsOpen || offlineView" @click="pick(i, o.label)"
      >
        <span class="n">{{ i + 1 }}</span><span class="l">{{ o.label }}<small v-if="o.hint">{{ o.hint }}</small></span>
      </button>
    </div>
  </div>
</template>
