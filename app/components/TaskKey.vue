<script setup lang="ts">
// A task's key (PRP-28) as a tag: a click or a tap copies it. The tag says
// "Copied" for a second, or "Copy failed" when the clipboard is refused.
const props = defineProps<{ value: string }>()

const state = ref<'' | 'done' | 'fail'>('')
let timer: ReturnType<typeof setTimeout> | undefined

// Outside a secure context (plain http on a LAN), navigator.clipboard is
// missing: a selected text field and execCommand still copy there.
function fallback(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  try { return document.execCommand('copy') } finally { ta.remove() }
}

async function copy(e: Event) {
  e.stopPropagation()
  let ok = false
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(props.value); ok = true }
    else ok = fallback(props.value)
  } catch { ok = false }
  state.value = ok ? 'done' : 'fail'
  clearTimeout(timer)
  timer = setTimeout(() => { state.value = '' }, 1000)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <button type="button" class="task-key task-key-copy" :class="state" :title="t('Copy ID')" :aria-label="`${t('Copy ID')} ${value}`" @click="copy">
    <span class="task-key-text">{{ value }}</span>
    <span v-if="state" class="task-key-flash" aria-live="polite">{{ state === 'done' ? t('Copied') : t('Copy failed') }}</span>
  </button>
</template>
