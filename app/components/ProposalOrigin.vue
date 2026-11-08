<script setup lang="ts">
// Where a workflow proposal comes from, on its card and in its review: who
// proposed it (the project's coordinator, with its key badge, or Alfred) and
// the user's message that led to it, in full (folded when long), with its time
// and, in the conversation, a link back to it.
import type { CoordinatorView } from '#shared/pm/coordinator'

const props = defineProps<{ c: CoordinatorView, canGoto?: boolean }>()
const emit = defineEmits<{ goto: [] }>()
const p = computed(() => props.c.proposal)
const main = computed(() => (p.value?.by ?? (props.c.main ? 'main' : props.c.project)) === 'main')
const key = computed(() => props.c.label ?? props.c.project)
// The palette's theme tokens, an existing color while a theme has none.
const FALLBACK: Record<string, string> = { violet: 'mauve', blue: 'blue', teal: 'teal', green: 'green', amber: 'blocked', orange: 'blocked', red: 'rose', pink: 'rose' }
const badge = computed(() => (props.c.color && !main.value ? `var(--project-${props.c.color}, var(--${FALLBACK[props.c.color] ?? 'mauve'}))` : ''))
const who = computed(() => (main.value ? alfred.value?.name || 'Alfred' : badge.value ? tl('coordinator') : `${key.value} ${tl('coordinator')}`))
// Long: more than 4 lines or 280 characters, shown folded until asked.
const long = computed(() => (p.value?.said?.length ?? 0) > 280 || (p.value?.said?.split('\n').length ?? 0) > 4)
const unfolded = ref(false)
</script>

<template>
  <div v-if="p" class="origin" data-testid="proposal-origin">
    <p class="origin-by" data-testid="proposal-by">
      <span class="muted">{{ tl('Proposed by') }}</span> <span v-if="badge" class="origin-key" :style="{ '--key-c': badge }" data-testid="proposal-key">{{ key }}</span>{{ badge ? ' ' : '' }}<span>{{ who }}</span>
    </p>
    <div v-if="p.said" class="origin-said">
      <span class="mono-label muted">{{ tl('Your request') }}<template v-if="p.saidAt"> · {{ fmtDateTime(p.saidAt) }}</template></span>
      <p class="origin-text" :class="{ folded: long && !unfolded }" data-testid="proposal-said">{{ p.said }}</p>
      <div v-if="long || canGoto" class="origin-actions">
        <UButton v-if="long" color="neutral" variant="ghost" size="lg" data-testid="proposal-said-more" @click="unfolded = !unfolded">{{ unfolded ? tl('Show less') : tl('Show all') }}</UButton>
        <UButton v-if="canGoto" color="neutral" variant="ghost" size="lg" icon="i-lucide-corner-left-up" data-testid="proposal-goto" @click="emit('goto')">{{ tl('Go to message') }}</UButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.origin { display: grid; gap: 6px; }
.origin-by { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.origin-key { padding: 0 6px; border: 1px solid var(--key-c); color: var(--key-c); background: color-mix(in srgb, var(--key-c) 12%, transparent); font: 600 12px/1.6 var(--font-mono); }
.origin-said { display: grid; gap: 4px; }
.origin-text { margin: 0; padding-left: 8px; border-left: 2px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; }
.origin-text.folded { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.origin-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-left: -10px; }
</style>
