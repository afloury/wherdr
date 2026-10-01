<script setup lang="ts">
// Tableau des quotas restants (fenêtre de 5 h et semaine), une ligne par compte :
// en haut de l'accueil (comptes communs à toutes les machines) et sous l'en-tête
// d'une machine (son compte Claude, quand les comptes diffèrent). Même grille à
// traits fins que les compteurs ; la barre montre ce qui reste, comme une batterie,
// ou ce qui est utilisé (Réglages → Apparence → Quotas). La couleur suit l'urgence.
// Lecture de plus d'une heure : âge en ocre, chiffres atténués ; fenêtre
// réinitialisée depuis la lecture : « réinitialisé », 100 % supposés ; fenêtre (5 h ou
// semaine) absente de la lecture de Claude (elle vient de repartir) : « fenêtre neuve ».
import type { QuotaWindow } from '#shared/types'
import { type QuotaRow, quotaLevel, quotaShown, resetText, STALE_MS } from '~/utils/quotas'

defineProps<{ rows: QuotaRow[] }>()

const now = quotaNow
const shown = (w: QuotaWindow) => quotaShown(w, now.value, quotaDisplay.value)
const level = (w: QuotaWindow) => quotaLevel(w, now.value)
const stale = (r: QuotaRow) => now.value - r.q.at > STALE_MS
function resetLabel(w: QuotaWindow) {
  if (w.fresh) return t('new window')
  const s = resetText(w, now.value, language)
  return s === null ? t('reset') : s || '—'
}
// Ancienneté courte de la lecture, sous le logo de chaque ligne (« 3 min », « 2 h »).
function agoShort(at: number) {
  const m = Math.round((now.value - at) / 60000)
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h` : tl(`${Math.round(h / 24)} d`, `${Math.round(h / 24)} j`)
}
function ago(at: number) {
  const m = Math.round((now.value - at) / 60000)
  if (m < 1) return t('just now')
  if (m < 60) return tl(`${m} min ago`, `il y a ${m} min`)
  const h = Math.round(m / 60)
  return h < 48 ? tl(`${h} h ago`, `il y a ${h} h`) : tl(`${Math.round(h / 24)} d ago`, `il y a ${Math.round(h / 24)} j`)
}
</script>

<template>
  <section v-if="rows.length" class="quotas" :aria-label="t(quotaDisplay === 'used' ? 'Used quotas' : 'Remaining quotas')">
    <div v-for="r in rows" :key="r.key" class="quota-row" :class="{ stale: stale(r) }">
      <div class="quota-who" :title="`${kindLabel(r.agent)} · ${t('updated')} ${ago(r.q.at)}`">
        <AgentAvatar :agent="r.agent" />
        <small><UIcon v-if="stale(r)" name="i-lucide-clock-alert" />{{ agoShort(r.q.at) }}</small>
      </div>
      <template v-for="(w, k) in { five: r.q.five, week: r.q.week }" :key="k">
        <div v-if="w" class="quota" :class="[level(w), { guessed: w.resetsAt && w.resetsAt <= now }]">
          <div class="quota-top">
            <span class="quota-label">{{ k === 'five' ? '5 h' : t('Week') }}</span>
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
