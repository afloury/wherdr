<script setup lang="ts">
// Live preview of the typewriter (Settings): sample reply
// revealed by ChatMarkdown, as in the conversation. Replayed on each
// change of speed or cipher text, and by the ↻ button.
import { previewStart, typingSample } from '~/utils/typingPreview'

const html = md(typingSample(language))
const typing = ref<number | null>(null)
const box = ref<HTMLElement | null>(null)
// Final height reserved (measured before the first reveal, full text):
// the card does not grow while writing.
const height = ref('')
const replay = () => { typing.value = previewStart(typingSpeed.value, Date.now()) }
onMounted(() => {
  if (box.value) height.value = `${box.value.offsetHeight}px`
  replay()
})
watch([typingSpeed, encryptedActive], replay)
</script>

<template>
  <figure class="typing-preview">
    <figcaption>
      <span>{{ t('Aperçu') }}</span>
      <UTooltip :text="t('Rejouer')">
        <button type="button" class="typing-replay" :aria-label="t('Rejouer')" :disabled="!typewriterActive" @click="replay">
          <UIcon name="i-lucide-rotate-ccw" />
        </button>
      </UTooltip>
    </figcaption>
    <div ref="box" class="typing-sample md" :style="{ minHeight: height }">
      <ChatMarkdown :html="html" :typing="typing" @done="typing = null" />
    </div>
  </figure>
</template>
