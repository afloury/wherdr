<script setup lang="ts">
// An agent's `ui action` button in its reply (shared/uiActions.ts), mounted by
// ChatMarkdown in place of its `action <id>` line. It reads the card from the
// server (never what the agent wrote); only this click runs it, through
// POST /api/ui/act, which checks again that the task still waits the same way.
// After: the outcome line; changed since: nothing runs, the task opens instead.
// A proposed setting change (kind 'setting'): before → after and the user's
// message behind it, Show me (highlights the setting), Cancel and Apply. A
// proposed project change (kind 'change'): the lines of its dry run instead.
import type { UiCard } from '#shared/uiActions'
import { appRoute } from '#shared/appLinks'
import { uiTargetLink } from '#shared/uiTargets'

const props = defineProps<{ id: string }>()
const card = ref<UiCard | null | undefined>(undefined)
const busy = ref<'' | 'run' | 'cancel'>('')
const router = useRouter()
const value = (v?: string) => (v === undefined ? t('default') : v === '1' ? t('on') : v === '0' ? t('off') : v)
// The proposal (a setting or a project change) and its target, if any.
const proposal = computed(() => card.value?.setting ?? card.value?.change)
function showMe() {
  const p = proposal.value, target = p?.target
  router.push(appRoute(target ? uiTargetLink(target, card.value?.change?.project) : '#/settings'))
}
const error = ref('')

async function load() {
  try { card.value = (await api<{ card: UiCard }>(`/api/ui/card?id=${encodeURIComponent(props.id)}`)).card }
  catch { card.value = null }
}
const onShow = () => { if (!document.hidden && card.value?.state === 'open') load() }
onMounted(() => { load(); document.addEventListener('visibilitychange', onShow) })
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onShow))

async function act(cancel = false) {
  const c = card.value
  if (!c || busy.value) return
  if (c.kind === 'open') return openTaskSheet(c.shown)
  busy.value = cancel ? 'cancel' : 'run'
  error.value = ''
  try {
    card.value = (await api<{ card: UiCard }>('/api/ui/act', { id: c.id, ...(cancel ? { cancel } : {}) })).card
    if (!c.setting && !c.change) taskChanged()
  }
  catch (e) { error.value = (e as Error).message; load() }
  finally { busy.value = '' }
}
</script>

<template>
  <div class="action-card" :class="card?.state ?? 'off'" data-testid="action-card">
    <span class="action-by">{{ !card ? t('Action') : card.setting ? tl(`Setting change proposed · by ${card.by}`) : card.change ? tl(`Change proposed · by ${card.by}`) : tl(`${card.by} suggests`) }}</span>
    <p v-if="card === undefined" class="action-line">{{ t('Loading…') }}</p>
    <p v-else-if="!card" class="action-line">{{ t('This action is no longer available') }}</p>
    <template v-else-if="proposal">
      <span class="action-task">{{ card.label }}</span>
      <p v-if="card.setting" class="action-change" data-testid="setting-change"><span>{{ value(card.setting.before) }}</span><UIcon name="i-lucide-arrow-right" /><b>{{ value(card.setting.after) }}</b></p>
      <ul v-else class="action-lines" data-testid="change-lines"><li v-for="(l, i) in card.change!.lines" :key="i">{{ l }}</li></ul>
      <p v-if="proposal.said" class="action-line">{{ t('After your message:') }} “{{ proposal.said }}”</p>
      <div v-if="card.state === 'open'" class="action-row">
        <UButton v-if="card.setting || proposal.target" color="neutral" variant="ghost" size="lg" icon="i-lucide-locate-fixed" data-testid="setting-show" @click="showMe">{{ t('Show me') }}</UButton>
        <span class="action-gap" />
        <UButton color="neutral" variant="outline" size="lg" :loading="busy === 'cancel'" :disabled="busy !== ''" data-testid="setting-cancel" @click="act(true)">{{ t('Cancel') }}</UButton>
        <UButton color="primary" size="lg" :loading="busy === 'run'" :disabled="busy !== ''" data-testid="setting-apply" @click="act()">{{ t('Apply') }}</UButton>
      </div>
      <p v-else-if="card.state === 'stale'" class="action-line" data-testid="action-stale">{{ card.setting ? t('This setting changed since: nothing was applied') : t('This changed since: nothing was applied') }}</p>
      <p v-else class="action-outcome" :class="{ no: card.state === 'dismissed' }" :title="fmtDateTime(card.outcome?.at ?? card.at)" data-testid="action-outcome">
        <UIcon :name="card.state === 'done' ? 'i-lucide-check' : 'i-lucide-x'" />{{ card.outcome?.text }} · {{ fmtTime(card.outcome?.at ?? card.at) }}
      </p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </template>
    <template v-else-if="card.state === 'open'">
      <div class="action-row">
        <span class="action-task">{{ card.shown }}</span>
        <UButton color="primary" size="lg" :loading="busy !== ''" :disabled="busy !== ''" data-testid="action-card-run" @click="act()">{{ card.label }}</UButton>
      </div>
      <p v-if="error || card.refused" class="form-error" role="alert" data-testid="action-refused">{{ error || card.refused }}</p>
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
.action-change { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; font: 13px/1.4 var(--font-mono); overflow-wrap: anywhere; }
.action-change > span { color: var(--text-2); }
.action-lines { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; font: 13px/1.4 var(--font-mono); overflow-wrap: anywhere; }
.action-gap { flex: 1 1 0; }
.action-outcome.no { color: var(--muted); }
.action-outcome { display: flex; align-items: center; gap: 6px; margin: 0; font: 12px/1.4 var(--font-mono); color: var(--green); overflow-wrap: anywhere; }
@media (max-width: 599px) { .action-row > :deep(button) { flex: 1 1 auto; } .action-gap { display: none; } }
</style>
