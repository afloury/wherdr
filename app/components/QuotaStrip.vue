<script setup lang="ts">
// Table of remaining quotas (5-hour window and week), one row per account:
// at the top of the home screen (accounts shared by all machines) and under the header
// of a machine (its Claude account, when accounts differ). Same thin-line
// grid as the counters; the bar shows what remains, like a battery,
// or what is used (Settings → Appearance → Quotas). The color follows urgency.
// Reading older than an hour: age in ochre, numbers dimmed; window
// reset since the reading: "reset", 100 % assumed; window (5 h or
// week) missing from Claude's reading (it just restarted): "fresh window".
import type { QuotaWindow } from '#shared/types'
import { type QuotaRow, quotaLevel, quotaShown, resetText, STALE_MS } from '~/utils/quotas'

defineProps<{ rows: QuotaRow[] }>()

const now = quotaNow
const shown = (w: QuotaWindow) => quotaShown(w, now.value, quotaDisplay.value)
const level = (w: QuotaWindow) => quotaLevel(w, now.value)
const stale = (r: QuotaRow) => now.value - r.q.at > STALE_MS
function resetLabel(w: QuotaWindow) {
  if (w.fresh) return t('fenêtre neuve')
  const s = resetText(w, now.value, language)
  return s === null ? t('réinitialisé') : s || '—'
}
// Short age of the reading, under each row's logo ("3 min", "2 h").
function agoShort(at: number) {
  const m = Math.round((now.value - at) / 60000)
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h` : tl(`${Math.round(h / 24)} j`, `${Math.round(h / 24)} d`)
}
function ago(at: number) {
  const m = Math.round((now.value - at) / 60000)
  if (m < 1) return t('à l’instant')
  if (m < 60) return tl(`il y a ${m} min`, `${m} min ago`)
  const h = Math.round(m / 60)
  return h < 48 ? tl(`il y a ${h} h`, `${h} h ago`) : tl(`il y a ${Math.round(h / 24)} j`, `${Math.round(h / 24)} d ago`)
}
</script>

<template>
  <section v-if="rows.length" class="quotas" :aria-label="t(quotaDisplay === 'used' ? 'Quotas utilisés' : 'Quotas restants')">
    <div v-for="r in rows" :key="r.key" class="quota-row" :class="{ stale: stale(r) }">
      <div class="quota-who" :title="`${kindLabel(r.agent)} · ${t('mis à jour')} ${ago(r.q.at)}`">
        <AgentAvatar :agent="r.agent" />
        <small><UIcon v-if="stale(r)" name="i-lucide-clock-alert" />{{ agoShort(r.q.at) }}</small>
      </div>
      <template v-for="(w, k) in { five: r.q.five, week: r.q.week }" :key="k">
        <div v-if="w" class="quota" :class="[level(w), { guessed: w.resetsAt && w.resetsAt <= now }]">
          <div class="quota-top">
            <span class="quota-label">{{ k === 'five' ? '5 h' : t('Semaine') }}</span>
            <b>{{ shown(w) }}<small>%</small></b>
          </div>
          <div class="quota-bar"><i :style="{ width: `${shown(w)}%` }" /></div>
          <div class="quota-reset"><UIcon name="i-lucide-rotate-cw" />{{ resetLabel(w) }}</div>
        </div>
        <div v-else class="quota empty" />
      </template>
    </div>
  </section>
</template>
