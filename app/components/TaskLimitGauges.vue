<script setup lang="ts">
// A task's limits (herdr-projects 1.2.16+), one thin gauge each: this run's
// time against `limit.time`, the task's tokens against `limit.tokens`, red
// from LIMIT_HOT of it on. A limit not set says so, with no gauge; the task's
// whole token count stays shown when it differs from what a gauge counts.
import type { TaskDetails } from '#shared/projectsTasks'
import { LIMIT_HOT, NO_LIMIT, formatDuration, limitShare, parseLimitTime, parseTokenCount } from '#shared/taskLimits'

const props = defineProps<{ limits: NonNullable<TaskDetails['limits']> }>()

interface Row { kind: 'time' | 'tokens', label: string, used: number | null, limit: number | null, raw: string, share: number | null }
const rows = computed<Row[]>(() => {
  const l = props.limits
  const timeLimit = parseLimitTime(l.time)
  // While a run goes on: its time. Stopped by it: what it had taken.
  const timeUsed = l.timeUsedMs ?? parseLimitTime(l.timeUsed) ?? (l.stopped === 'time' ? l.stoppedUsed ?? null : null)
  const tokenLimit = parseTokenCount(l.tokens)
  const tokensUsed = l.tokensCounted ?? (l.stopped === 'tokens' ? l.stoppedUsed ?? null : null) ?? l.tokensUsed
  return [
    { kind: 'time', label: tl('Time · this run', 'Temps · cette tranche'), used: timeUsed, limit: timeLimit, raw: l.time, share: limitShare(timeUsed, timeLimit) },
    { kind: 'tokens', label: tl('Tokens', 'Tokens'), used: tokensUsed, limit: tokenLimit, raw: l.tokens, share: limitShare(tokensUsed, tokenLimit) },
  ]
})
// The whole task's count, when the gauge counts something else.
const total = computed(() => {
  const l = props.limits
  const counted = rows.value[1]!.used
  return l.tokensUsed !== null && l.tokensUsed !== counted ? l.tokensUsed : null
})
const width = (r: Row) => `${Math.min(100, Math.max(0, (r.share ?? 0) * 100))}%`
const unset = (r: Row) => r.raw === NO_LIMIT ? tl('No limit', 'Aucune limite') : r.raw || tl('Not provided', 'Non renseigné')
</script>

<template>
  <section class="task-sheet-block task-limits" :aria-label="tl('Limits', 'Limites')">
    <div v-for="r in rows" :key="r.kind" class="task-limit" :data-kind="r.kind" :class="{ hot: (r.share ?? 0) >= LIMIT_HOT, unset: r.limit === null }">
      <div class="task-limit-head">
        <span class="task-limit-label">{{ r.label }}</span>
        <span class="task-limit-value">
          <template v-if="r.kind === 'time'">{{ r.used === null ? '—' : formatDuration(r.used) }} / {{ r.limit === null ? unset(r) : formatDuration(r.limit) }}</template>
          <template v-else><TokenCount v-if="r.used !== null" :value="r.used" /><template v-else>—</template> / <TokenCount v-if="r.limit !== null" :value="r.limit" /><template v-else>{{ unset(r) }}</template></template>
        </span>
      </div>
      <div v-if="r.limit !== null" class="task-limit-bar" role="meter" :aria-label="r.label" :aria-valuemin="0" :aria-valuemax="r.limit" :aria-valuenow="r.used ?? 0">
        <i :style="{ width: width(r) }" />
      </div>
    </div>
    <p v-if="total !== null" class="task-limit-total">{{ tl('Whole task', 'Toute la tâche') }} · <TokenCount :value="total" /></p>
  </section>
</template>
