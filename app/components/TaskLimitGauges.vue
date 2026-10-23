<script setup lang="ts">
// A task's limits (herdr-projects 1.2.16+), one thin gauge each: this run's
// time against `limit.time`, the task's tokens against `limit.tokens`. A
// limit not set shows nothing; red from LIMIT_HOT of it on.
import type { TaskLimits } from '#shared/projectsTasks'
import { LIMIT_HOT, formatDuration, limitShare, parseLimitTime, parseTokenCount } from '#shared/taskLimits'

const props = defineProps<{ limits: TaskLimits }>()

interface Gauge { kind: 'time' | 'tokens', label: string, used: number | null, limit: number, share: number | null }
const gauges = computed<Gauge[]>(() => {
  const l = props.limits
  const out: Gauge[] = []
  const timeLimit = parseLimitTime(l.time)
  if (timeLimit !== null) {
    // While a run goes on: its time. Stopped by it: what it had taken.
    const used = l.timeUsedMs ?? parseLimitTime(l.timeUsed) ?? (l.stopped?.what === 'time' ? l.stopped.used : null)
    out.push({ kind: 'time', label: tl('Time', 'Temps'), used, limit: timeLimit, share: limitShare(used, timeLimit) })
  }
  const tokenLimit = parseTokenCount(l.tokens)
  if (tokenLimit !== null) {
    const used = l.tokensCounted ?? (l.stopped?.what === 'tokens' ? l.stopped.used : null)
    out.push({ kind: 'tokens', label: tl('Tokens', 'Tokens'), used, limit: tokenLimit, share: limitShare(used, tokenLimit) })
  }
  return out
})
const width = (g: Gauge) => `${Math.min(100, Math.max(0, (g.share ?? 0) * 100))}%`
</script>

<template>
  <section v-if="gauges.length" class="task-sheet-block task-limits" :aria-label="tl('Limits', 'Limites')">
    <div v-for="g in gauges" :key="g.kind" class="task-limit" :data-kind="g.kind" :class="{ hot: (g.share ?? 0) >= LIMIT_HOT }">
      <div class="task-limit-head">
        <span class="task-limit-label">{{ g.label }}</span>
        <span class="task-limit-value">
          <template v-if="g.kind === 'time'">{{ g.used === null ? '—' : formatDuration(g.used) }} / {{ formatDuration(g.limit) }}</template>
          <template v-else><TokenCount v-if="g.used !== null" :value="g.used" /><template v-else>—</template> / <TokenCount :value="g.limit" /></template>
        </span>
      </div>
      <div class="task-limit-bar" role="meter" :aria-label="g.label" :aria-valuemin="0" :aria-valuemax="g.limit" :aria-valuenow="g.used ?? 0">
        <i :style="{ width: width(g) }" />
      </div>
    </div>
  </section>
</template>
