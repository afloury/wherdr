<script setup lang="ts">
// A Working task that is not running an agent says so: `CI 1/2` while the
// board waits for GitHub checks, `QUEUED · DEMO-3` while it waits its turn.
// Nothing for a running agent (shared/taskActivity.ts).
import { type TaskActivity, ciTally, queuedWhat } from '#shared/taskActivity'
import { queuePlaceText } from '~/utils/taskWait'

const props = defineProps<{ activity: TaskActivity | null | undefined }>()

const text = computed(() => {
  const a = props.activity
  if (a?.kind === 'ci') return ['CI', ciTally(a)].filter(Boolean).join(' ')
  if (a?.kind === 'queued') return [tl('Queued', 'En file'), queuedWhat(a)].filter(Boolean).join(' · ')
  return ''
})
const hint = computed(() => {
  const a = props.activity
  if (a?.kind === 'ci') {
    return a.total !== null
      ? tl(`Agent done, waiting for GitHub checks: ${a.passed} of ${a.total} passed`, `Agent terminé, attend les checks GitHub : ${a.passed} sur ${a.total} réussis`)
      : tl('Agent done, waiting for GitHub checks', 'Agent terminé, attend les checks GitHub')
  }
  if (a?.kind === 'queued') {
    if (a.after) return tl(`Not started: waits for ${a.after}`, `Pas démarrée : attend ${a.after}`)
    return a.place
      ? `${tl('Not started: waiting for a free slot', 'Pas démarrée : attend une place libre')}, ${queuePlaceText(a.place)}`
      : tl('Not started: waiting its turn', 'Pas démarrée : attend son tour')
  }
  return ''
})
</script>

<template>
  <span v-if="text" class="task-activity" :data-kind="activity!.kind" :title="hint" :aria-label="hint">{{ text }}</span>
</template>
