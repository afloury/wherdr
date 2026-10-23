<script setup lang="ts">
// Raise the limit that stopped a task: a few presets, each one `herdr-projects
// set limit.time|limit.tokens <value> --task <id>` and nothing else. The board
// then carries on by itself within seconds, keeping what was already used; a
// preset that would stay at or under that is offered disabled.
import { type LimitPreset, type LimitStop, formatDuration, formatLimit, formatTokenCount, raisePresets } from '#shared/taskLimits'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{ machine: string, id: string, stop: LimitStop, disabled?: boolean }>()
const emit = defineEmits<{ raised: [value: string] }>()

const presets = computed(() => raisePresets(props.stop.kind, props.stop.limit, props.stop.used))
const now = computed(() => formatLimit(props.stop.kind, props.stop.limit, language))
const used = computed(() => props.stop.used === null ? '' : props.stop.kind === 'time' ? formatDuration(props.stop.used) : formatTokenCount(props.stop.used, language))
const sending = ref<string | null>(null)
const error = ref('')
watch(open, (v) => { if (v) { error.value = ''; sending.value = null } })

function presetLabel(p: LimitPreset): string {
  switch (p.id) {
    case 'plus1h': return '+1 h'
    case 'plus10m': return '+10 M'
    case 'double': return '×2'
    default: return tl('No limit', 'Sans limite')
  }
}
const presetTo = (p: LimitPreset) => p.value === 'none' ? '' : formatLimit(props.stop.kind, p.value, language)

async function raise(p: LimitPreset) {
  if (sending.value || props.disabled || !p.resumes) return
  sending.value = p.id
  error.value = ''
  try {
    await api('/api/tasks/limit', { machine: props.machine, id: props.id, kind: props.stop.kind, value: p.value })
    haptic()
    open.value = false
    emit('raised', p.value)
  } catch (e) { error.value = (e as Error).message }
  finally { sending.value = null }
}
</script>

<template>
  <AppSheet v-model:open="open" :title="tl('Raise the limit', 'Relever la limite')">
    <div class="raise-limit">
      <p class="raise-limit-now">
        <span class="raise-limit-label">{{ stop.kind === 'time' ? tl('Time, one run', 'Temps, un passage') : tl('Tokens, whole task', 'Tokens, toute la tâche') }}</span>
        <span class="raise-limit-value">{{ used ? `${used} / ${now}` : now }}</span>
      </p>
      <div class="raise-limit-presets">
        <UButton
          v-for="p in presets" :key="p.id" :data-preset="p.id" color="neutral" variant="outline" class="raise-limit-preset"
          :loading="sending === p.id" :disabled="Boolean(sending) || disabled || !p.resumes"
          :title="p.resumes ? undefined : tl('Not above what it already used', 'Pas au-dessus de ce qu’elle a déjà utilisé')"
          @click="raise(p)"
        >
          <span class="raise-limit-op">{{ presetLabel(p) }}</span><span v-if="presetTo(p)" class="raise-limit-to">{{ presetTo(p) }}</span>
        </UButton>
      </div>
      <p class="raise-limit-hint">
        {{ stop.kind === 'time'
          ? tl('The run carries on by itself within seconds, from the time it already took.', 'Le passage reprend tout seul en quelques secondes, à partir du temps déjà pris.')
          : tl('The task carries on by itself within seconds; the tokens it used still count.', 'La tâche reprend toute seule en quelques secondes ; les tokens déjà utilisés comptent toujours.') }}
      </p>
      <p v-if="error" class="board-note error">{{ error }}</p>
    </div>
  </AppSheet>
</template>
