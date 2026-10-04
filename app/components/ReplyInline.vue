<script setup lang="ts">
// TEMPORARY (t-0199, concept c): answer field placed right under a question
// or a selected passage, inside the agent message. The drawer of the
// composer gathers the answers and sends them in one message.
import { removeRef, type ReplyRef } from '~/utils/replyUx'

const props = defineProps<{ paneId: string, item: ReplyRef }>()
</script>

<template>
  <div class="rc-inline" :class="{ done: item.answer.trim() }" @click.stop>
    <div class="rc-inline-head">
      <span class="rc-inline-label">↳ {{ item.kind === 'question' ? tl('Your answer', 'Ta réponse') : tl('About', 'À propos de') }}</span>
      <span v-if="item.kind === 'passage'" class="rc-inline-quote">« {{ item.text }} »</span>
      <button type="button" class="rc-x" :aria-label="t('Remove quote')" @click="removeRef(props.paneId, item.id)">
        <UIcon name="i-lucide-x" />
      </button>
    </div>
    <UTextarea
      v-model="item.answer" :rows="1" :maxrows="5" autoresize variant="none" autocapitalize="sentences"
      :placeholder="tl('Type your answer…', 'Écris ta réponse…')" class="rc-inline-field" :ui="{ base: 'rc-inline-input' }"
    />
  </div>
</template>
