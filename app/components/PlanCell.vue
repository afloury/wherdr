<script setup lang="ts">
// Case du plan d'un onglet (téléphone) : agent, état, dernière ligne, et
// réponse en un tap si l'agent attend. Toucher la case ouvre le pane en plein écran.
import type { Pane } from '#shared/types'

const props = defineProps<{ pane: Pane, focused?: boolean, fresh?: boolean }>()
const emit = defineEmits<{ open: [] }>()
const busy = ref(false)
const prompt = computed(() => (props.pane.status === 'blocked' && props.pane.prompt?.options?.length ? props.pane.prompt : null))
const line = computed(() => (prompt.value ? prompt.value.question : props.pane.preview) || (props.pane.agent ? '' : shortPath(props.pane.cwd)))
async function pick(i: number, label: string) {
  busy.value = true
  if (!(await choose(props.pane.id, i, label))) busy.value = false
}
watch(() => props.pane.prompt, () => { busy.value = false })
</script>

<template>
  <div
    class="plan-cell" :class="[statusKey(pane), { stale: paneStale(pane), fresh }]" role="button" tabindex="0" :data-pane="pane.id"
    @click="emit('open')" @keydown.enter.self="emit('open')"
  >
    <div class="plan-cell-head">
      <AgentAvatar :agent="pane.agent" />
      <span class="plan-cell-title">{{ paneTitle(pane) }}</span>
      <span v-if="focused" class="plan-cell-focus" :title="t('Pane actif dans Herdr')" />
      <SpaceMenu :items="() => paneItems(pane)" :title="paneTitle(pane)" size="sm" :label="t('Options du pane')" />
    </div>
    <StatusPill :pane="pane" model />
    <p v-if="line" class="plan-cell-line">{{ line }}</p>
    <div v-if="prompt" class="plan-cell-choices">
      <button
        v-for="(o, i) in prompt.options.slice(0, 3)" :key="i" type="button"
        :disabled="busy || !eventsOpen || offlineView || paneStale(pane)" @click.stop="pick(i, o.label)"
      >
        <span class="n">{{ i + 1 }}</span><span class="l">{{ o.label }}</span>
      </button>
    </div>
  </div>
</template>
