<script setup lang="ts">
// "Report a problem" in a task's sheet: what is wrong, the screenshots it is
// about (tap a thumbnail to pick it), and whether the merge waits for the fix.
// The sheet sends it to the project's coordinator (POST /api/pm/report).
import { REPORT_MAX } from '#shared/pm/report'
import { shotUrl } from '#shared/pm/shots'
import type { Card } from '#shared/pm/board'

const props = defineProps<{ card: Card, busy: boolean }>()
const emit = defineEmits<{ send: [report: { text: string, shots: string[], block: boolean }], cancel: [] }>()

// The newest step's screenshots of the result, as the To do view shows them.
const shots = computed(() => {
  const s = shotSteps(props.card)[0]
  return s ? props.card.state!.shots![s.id]!.filter(x => x.phase === 'after').map(x => x.file) : []
})
const text = ref('')
const picked = ref<string[]>([])
const block = ref(true)
const toggle = (f: string) => { picked.value = picked.value.includes(f) ? picked.value.filter(x => x !== f) : [...picked.value, f] }
const send = () => emit('send', { text: text.value.trim(), shots: shots.value.filter(f => picked.value.includes(f)), block: block.value })
</script>

<template>
  <form class="report" data-testid="task-report" @submit.prevent="send">
    <p class="mono-label">{{ tl('Report a problem') }}</p>
    <p class="muted">{{ tl('It goes to the project\'s coordinator, which decides what to do.') }}</p>
    <UTextarea v-model="text" :rows="3" autoresize :maxlength="REPORT_MAX" size="xl" :placeholder="tl('What is wrong')" data-testid="task-report-text" />
    <template v-if="shots.length">
      <span class="field-label">{{ tl('Screenshots concerned') }} <span class="muted">{{ tl('(optional)', '(facultatif)') }}</span></span>
      <ul class="report-shots">
        <li v-for="(f, i) in shots" :key="f">
          <button type="button" class="report-shot" :class="{ on: picked.includes(f) }" :aria-pressed="picked.includes(f)" :aria-label="tl(`Screenshot ${i + 1}`)" data-testid="task-report-shot" @click="toggle(f)">
            <img :src="shotUrl(card.id, f)" alt="" loading="lazy" decoding="async">
            <UIcon v-if="picked.includes(f)" name="i-lucide-check" class="report-check" />
          </button>
        </li>
      </ul>
    </template>
    <label class="toggle-row">
      <span><b>{{ tl('Block the merge until fixed') }}</b><small>{{ tl('Merge stays refused until the coordinator acts or you withdraw this') }}</small></span>
      <USwitch v-model="block" color="success" size="xl" data-testid="task-report-block" />
    </label>
    <div class="task-sheet-actions">
      <UButton type="submit" color="primary" size="xl" icon="i-lucide-send" :loading="busy" :disabled="!text.trim()" data-testid="task-report-send">{{ tl('Send to the coordinator') }}</UButton>
      <UButton color="neutral" variant="outline" size="xl" :disabled="busy" @click="emit('cancel')">{{ t('Cancel') }}</UButton>
    </div>
  </form>
</template>

<style scoped>
.report { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--line); }
.report-shots { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.report-shot { position: relative; display: block; width: 88px; height: 64px; padding: 0; border: 1px solid var(--line); background: var(--surface); cursor: pointer; overflow: hidden; }
.report-shot img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.report-shot.on { border: 2px solid var(--accent); }
.report-check { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; color: var(--on-accent); background: var(--accent); }
.task-sheet-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
