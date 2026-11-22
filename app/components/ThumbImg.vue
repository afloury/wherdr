<script setup lang="ts">
// One photo of a message, as the message field's square tile (AttachTile). A photo just sent from this device shows its
// local preview until the uploaded copy has loaded (utils/sentPreviews.ts).
// A failed load is retried once after a short delay, or at once when the page
// comes back to the front; still failing: a placeholder that reloads it.
import { dropPreview, previewFor } from '~/utils/sentPreviews'
import { photoTile } from '~/utils/attachTiles'

const props = defineProps<{ src: string }>()
const emit = defineEmits<{ open: [] }>()
const RETRY_MS = 1500
const tile = computed(() => photoTile(props.src))

const attempt = ref(0)
const state = ref<'loading' | 'ok' | 'retry' | 'broken'>('loading')
const preview = ref(previewFor(props.src))
// A retry asks again under another URL: no failed answer reused.
const url = computed(() => attempt.value ? `${props.src}${props.src.includes('?') ? '&' : '?'}retry=${attempt.value}` : props.src)
let timer: ReturnType<typeof setTimeout> | undefined
let probe: HTMLImageElement | null = null

function loaded() {
  state.value = 'ok'
  if (preview.value) dropPreview(props.src)
  preview.value = null
}
function failed() {
  if (attempt.value > 0) { state.value = 'broken'; return }
  state.value = 'retry'
  timer = setTimeout(retry, RETRY_MS)
}
function retry() {
  clearTimeout(timer)
  timer = undefined
  attempt.value++
  state.value = 'loading'
}
// With a preview on screen, the uploaded copy loads out of sight.
watch(url, (u) => {
  if (!preview.value) return
  if (probe) probe.onload = probe.onerror = null
  probe = new Image()
  probe.onload = loaded
  probe.onerror = failed
  probe.src = u
}, { immediate: true })
function onVisible() { if (document.visibilityState === 'visible' && state.value === 'retry') retry() }
onMounted(() => document.addEventListener('visibilitychange', onVisible))
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisible)
  clearTimeout(timer)
  if (probe) probe.onload = probe.onerror = null
})
</script>

<template>
  <button v-if="state === 'broken'" type="button" class="att-tile thumb-missing thumb-reload" @click="retry">
    <UIcon name="i-lucide-image-off" /><span>{{ t('Tap to reload') }}</span>
  </button>
  <AttachTile
    v-else v-bind="tile" sent :url="preview || url" :class="{ 'thumb-wait': !preview && state === 'retry' }"
    @open="emit('open')" @load="!preview && loaded()" @error="!preview && failed()"
  />
</template>
