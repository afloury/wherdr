<script setup lang="ts">
// One review comment, shown as a thread under the last line of its block: the
// editor while it is being written, the saved text with Edit and Delete after.
import type { ReviewAction, ReviewComment } from '#shared/review'
const props = defineProps<{ comment: ReviewComment, label: string, missing?: boolean, changed?: boolean }>()
const emit = defineEmits<{ act: [action: ReviewAction, id: string, text?: string], hover: [id: string | null] }>()
const editing = computed(() => props.comment.draft !== undefined)
const text = computed(() => props.comment.draft ?? '')
const dirty = computed(() => text.value.trim() !== props.comment.body.trim())
// Losing written text takes a second press: Cancel on a changed text, Delete on a saved one.
const armed = ref<'' | 'cancel' | 'remove'>('')
watch(editing, () => { armed.value = '' })
const saveKeys = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '') ? '⌘↵' : 'Ctrl+↵'

function input(e: Event) {
  armed.value = ''
  emit('act', 'draft', props.comment.id, (e.target as HTMLTextAreaElement).value)
}
function save() { if (text.value.trim()) emit('act', 'save', props.comment.id) }
function cancel() {
  if (dirty.value && armed.value !== 'cancel') { armed.value = 'cancel'; return }
  emit('act', 'cancel', props.comment.id)
}
function remove() {
  if (armed.value !== 'remove') { armed.value = 'remove'; return }
  emit('act', 'remove', props.comment.id)
}
function key(e: KeyboardEvent) {
  if (e.isComposing) return
  if (e.key === 'Escape') {
    // The window around the diff closes on Escape too: this one is for the editor.
    e.preventDefault()
    e.stopPropagation()
    cancel()
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    save()
  }
}
</script>
<template>
  <div
    class="review-note" :class="{ missing, editing }" role="group" :aria-label="`${label}: ${t('review comment')}`"
    @mouseenter="emit('hover', comment.id)" @mouseleave="emit('hover', null)" @focusin="emit('hover', comment.id)" @focusout="emit('hover', null)"
  >
    <div class="review-note-head">
      <span class="review-range">{{ label }}</span>
      <span v-if="missing" class="review-path">{{ comment.path }}</span>
    </div>
    <p v-if="missing" class="review-warning" role="status">{{ changed ? t('The code of this block changed. Check this comment before sending.') : t('No longer in the diff. Check this comment before sending.') }}</p>
    <template v-if="editing">
      <textarea
        :id="`review-${comment.id}`" :value="text" :placeholder="t('Write a review comment…')" :aria-label="`${label}: ${t('review comment')}`" rows="3"
        @input="input" @keydown="key" @focus="($event.target as HTMLTextAreaElement).scrollIntoView({ block: 'nearest' })"
      />
      <div class="review-note-actions">
        <span class="review-keys" aria-hidden="true">{{ saveKeys }} {{ t('to save') }} · Esc {{ t('to cancel') }}</span>
        <button type="button" class="review-btn" :class="{ armed: armed === 'cancel' }" @click="cancel">{{ armed === 'cancel' ? t('Discard this text?') : t('Cancel') }}</button>
        <button type="button" class="review-btn primary" :disabled="!text.trim()" @click="save">{{ comment.body ? t('Save') : t('Comment') }}</button>
      </div>
    </template>
    <template v-else>
      <p class="review-body">{{ comment.body }}</p>
      <div class="review-note-actions">
        <button type="button" class="review-btn" :aria-label="t('Edit comment')" @click="emit('act', 'edit', comment.id)">{{ tl('Edit', 'Modifier') }}</button>
        <button type="button" class="review-btn" :class="{ armed: armed === 'remove' }" :aria-label="armed === 'remove' ? t('Confirm delete') : t('Delete comment')" @click="remove" @blur="armed = ''">{{ armed === 'remove' ? t('Confirm delete') : t('Delete') }}</button>
      </div>
    </template>
  </div>
</template>
