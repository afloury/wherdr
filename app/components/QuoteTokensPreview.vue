<script setup lang="ts">
// Animated preview of quoted replies (Settings › Conversation), drawn in
// CSS with the theme colors: "↳ Reply" on a question, its quote in the
// field (as the chosen mode draws it), the answer typed, a second quote, then
// the message sent (the conversation moves up to it, the field empties), and
// back to the composed field, where it rests. Played once, then replayed on
// each change of mode and by the ↻ button, like the typewriter preview.
// Reduced motion: the composed field, still.
import type { QuoteMode } from '~/utils/quoteTokens'

const props = defineProps<{ mode: QuoteMode }>()
// A new key restarts the CSS timeline from its first frame.
const run = ref(0)
const playing = ref(false)
const replay = () => {
  if (reducedMotion.value) return
  run.value++
  playing.value = true
}
onMounted(replay)
watch(() => props.mode, replay)
</script>

<template>
  <figure class="qt-preview" :data-mode="mode" :data-playing="playing">
    <figcaption>
      <span>{{ t('Preview') }}</span>
      <UTooltip :text="t('Replay')">
        <button type="button" class="typing-replay" :aria-label="t('Replay')" :disabled="reducedMotion" @click="replay">
          <UIcon name="i-lucide-rotate-ccw" />
        </button>
      </UTooltip>
    </figcaption>
    <div :key="run" class="qt-stage" aria-hidden="true" @animationend="playing = false">
      <div class="qt-conv">
        <div class="qt-agent">
          <p>{{ tl('Tea or coffee?', 'Thé ou café ?') }} <span class="qt-tag one">↳ {{ t('Reply') }}</span></p>
          <p>{{ tl('And your favorite series?', 'Et ta série préférée ?') }} <span class="qt-tag two">↳ {{ t('Reply') }}</span></p>
        </div>
        <div class="qt-sent">
          <span class="qt-sent-q">{{ tl('Tea or coffee?', 'Thé ou café ?') }}</span>
          <span>{{ tl('Coffee.', 'Café.') }}</span>
          <span class="qt-sent-q">{{ tl('And your favorite series?', 'Et ta série préférée ?') }}</span>
          <span>Lost !</span>
        </div>
      </div>
      <div v-if="mode === 'lines'" class="qt-chips">
        <span class="qt-chip one">{{ tl('Tea or coffee?', 'Thé ou café ?') }}<i>✕</i></span>
        <span class="qt-chip two">{{ tl('And your favorite series?', 'Et ta série préférée ?') }}<i>✕</i></span>
      </div>
      <div class="qt-field">
        <span class="qt-ph">{{ tl('Message to Claude…', 'Message à Claude…') }}</span>
        <span class="qt-tok one"><b>{{ mode === 'lines' ? '>' : '↳' }}</b>{{ tl('Tea or coffee?', 'Thé ou café ?') }}<i v-if="mode === 'rich'">✕</i></span>
        <span class="qt-ans one">{{ tl('Coffee.', 'Café.') }}</span>
        <span class="qt-tok two"><b>{{ mode === 'lines' ? '>' : '↳' }}</b>{{ tl('And your favorite series?', 'Et ta série préférée ?') }}<i v-if="mode === 'rich'">✕</i></span>
        <span class="qt-ans two">Lost !</span>
        <span class="qt-send">↑</span>
      </div>
    </div>
  </figure>
</template>
