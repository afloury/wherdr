<script setup lang="ts">
import type { ReviewComment } from '#shared/review'
defineProps<{ comment: ReviewComment, missing?: boolean }>()
const emit = defineEmits<{ update: [id: string, body: string], remove: [id: string] }>()
</script>
<template>
  <div class="review-note" :class="{ missing }">
    <label :for="`review-${comment.id}`">{{ comment.path }}:{{ comment.number }} <span v-if="comment.side === 'old'">({{ t('old line') }})</span></label>
    <p v-if="missing" role="status">{{ t('Line no longer in the diff. Check this comment before sending.') }}</p>
    <textarea :id="`review-${comment.id}`" :value="comment.body" :placeholder="t('Write a review comment…')" rows="3" @input="emit('update', comment.id, ($event.target as HTMLTextAreaElement).value)" @focus="($event.target as HTMLTextAreaElement).scrollIntoView({ block: 'nearest' })" />
    <button type="button" @click="emit('remove', comment.id)">{{ t('Delete comment') }}</button>
  </div>
</template>
