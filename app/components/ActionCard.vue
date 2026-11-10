<script setup lang="ts">
// An agent's `ui action` button in its reply (shared/uiActions.ts), mounted by
// ChatMarkdown in place of its `action <id>` line. It reads the card from the
// server (never what the agent wrote); only this click runs it, through
// POST /api/ui/act, which checks again that the task still waits the same way.
// After: the outcome line; changed since: nothing runs, the task opens instead.
import type { UiCard } from '#shared/uiActions'

const props = defineProps<{ id: string }>()
const card = ref<UiCard | null | undefined>(undefined)
const busy = ref(false)
const error = ref('')

async function load() {
  try { card.value = (await api<{ card: UiCard }>(`/api/ui/card?id=${encodeURIComponent(props.id)}`)).card }
  catch { card.value = null }
}
const onShow = () => { if (!document.hidden && card.value?.state === 'open') load() }
onMounted(() => { load(); document.addEventListener('visibilitychange', onShow) })
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onShow))

async function act() {
  const c = card.value
  if (!c || busy.value) return
  if (c.kind === 'open') return openTaskSheet(c.shown)
  busy.value = true
  error.value = ''
  try { card.value = (await api<{ card: UiCard }>('/api/ui/act', { id: c.id })).card; taskChanged() }
  catch (e) { error.value = (e as Error).message; load() }
  finally { busy.value = false }
}
</script>

<template>
  <div class="action-card" :class="card?.state ?? 'off'" data-testid="action-card">
    <span class="action-by">{{ card ? tl(`${card.by} suggests`) : t('Action') }}</span>
    <p v-if="card === undefined" class="action-line">{{ t('Loading…') }}</p>
    <p v-else-if="!card" class="action-line">{{ t('This action is no longer available') }}</p>
    <template v-else-if="card.state === 'open'">
      <div class="action-row">
        <span class="action-task">{{ card.shown }}</span>
        <UButton color="primary" size="lg" :loading="busy" :disabled="busy" data-testid="action-card-run" @click="act">{{ card.label }}</UButton>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </template>
    <p v-else-if="card.state === 'done'" class="action-outcome" :title="fmtDateTime(card.outcome?.at ?? card.at)" data-testid="action-outcome">
      <UIcon name="i-lucide-check" />{{ card.outcome?.text ?? t('Done by you') }} · {{ fmtTime(card.outcome?.at ?? card.at) }}
    </p>
    <div v-else class="action-row">
      <span class="action-line" data-testid="action-stale">{{ t('This changed since') }}</span>
      <UButton color="neutral" variant="outline" size="lg" @click="openTaskSheet(card.shown)">{{ t('Open the task') }}</UButton>
    </div>
  </div>
</template>

<style scoped>
.action-card { display: grid; gap: 6px; min-width: 0; padding: 10px 12px; border: 1px solid var(--line); border-left: 3px solid var(--blocked); background: var(--surface); }
.action-card:not(.open) { border-left-color: var(--line); }
.action-by { font: 500 11px/1.4 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--text-2); overflow-wrap: anywhere; }
.action-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.action-task { font: 600 14px/1.4 var(--font-mono); overflow-wrap: anywhere; }
.action-line { margin: 0; color: var(--text-2); overflow-wrap: anywhere; }
.action-outcome { display: flex; align-items: center; gap: 6px; margin: 0; font: 12px/1.4 var(--font-mono); color: var(--green); overflow-wrap: anywhere; }
@media (max-width: 599px) { .action-row > :deep(button) { flex: 1 1 auto; } }
</style>
