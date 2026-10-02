<script setup lang="ts">
// Name filter above a folder list (recent folders, browser subfolders).
// Enter emits `pick` once something is typed (the caller takes the first
// match); Escape empties a filled field instead of closing the sheet.
const query = defineModel<string>({ required: true })
defineProps<{ label: string }>()
const emit = defineEmits<{ pick: [] }>()
const input = useTemplateRef('input')
// Safari ends an IME composition before the key that confirms it: keyCode 229.
const composing = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229
function onEnter(e: KeyboardEvent) {
  if (composing(e)) return
  e.preventDefault()
  if (!e.repeat && query.value.trim()) emit('pick')
}
function onEscape(e: KeyboardEvent) {
  if (!query.value && !composing(e)) return
  e.stopPropagation()
  if (!composing(e)) query.value = ''
}
function clear() {
  query.value = ''
  input.value?.focus()
}
</script>

<template>
  <div class="name-filter">
    <UIcon name="i-lucide-search" />
    <input
      ref="input" v-model="query" type="text" enterkeyhint="go" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
      :aria-label="label" :placeholder="label" @keydown.enter="onEnter" @keydown.esc="onEscape"
    >
    <button v-if="query" type="button" :aria-label="tl('Clear filter', 'Vider le filtre')" :title="tl('Clear filter', 'Vider le filtre')" @click="clear">
      <UIcon name="i-lucide-x" />
    </button>
  </div>
</template>
