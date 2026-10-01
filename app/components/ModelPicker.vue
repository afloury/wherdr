<script setup lang="ts">
// Model selector, in the footer of the input bar (like the Nuxt UI
// UChatPrompt examples). Shows the agent's current model; the options
// come from the agent's real /model menu (read by the server, then cached).
// The change only applies to this agent session. Unavailable when
// the agent is working or waiting for an answer.
import type { EffortList, ModelInfo, ModelList, ModelOption, Pane } from '#shared/types'
import { currentModelOption } from '~/utils/modelSelection'

const props = defineProps<{ pane: Pane }>()

const modelOpen = ref(false)
const effortOpen = ref(false)
const modelsLoading = ref(false)
const effortsLoading = ref(false)
const switching = ref(false)
const list = ref<ModelList | null>(null)
const efforts = ref<EffortList | null>(null)
// Choice just made: shown until the server state has picked it up.
const chosen = ref<{ info: ModelInfo, at: number } | null>(null)

const baseName = (s: string | null | undefined) => String(s || '').trim().toLowerCase()
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b) && baseName(a) === baseName(b)

const model = computed<ModelInfo | null>(() => {
  const c = chosen.value
  if (c && Date.now() - c.at < 20000 && (!same(props.pane.model?.label, c.info.label) || props.pane.model?.effort !== c.info.effort)) return c.info
  const info = props.pane.model
  return info ? { ...info, effort: info.effort || efforts.value?.current || null } : null
})
watch(() => [props.pane.model?.label, props.pane.model?.effort], () => {
  if (chosen.value && same(props.pane.model?.label, chosen.value.info.label) && props.pane.model?.effort === chosen.value.info.effort) chosen.value = null
})

const why = computed(() => {
  if (!eventsOpen.value || offlineView.value || paneStale(props.pane)) return t('Modification indisponible hors ligne')
  const s = props.pane.status
  if (s === 'working') return t('L’agent travaille — change de modèle quand il a fini.')
  if (s === 'blocked') return t('L’agent attend une réponse — réponds-lui d’abord.')
  return null
})
const locked = computed(() => Boolean(why.value) || switching.value)

async function loadModels(refresh = false) {
  if (modelsLoading.value) return
  modelsLoading.value = true
  try {
    list.value = await api<ModelList>(`/api/models?pane=${encodeURIComponent(props.pane.id)}${refresh ? '&refresh=1' : ''}`)
  } catch (err) {
    modelOpen.value = false
    toast((err as Error).message, true)
  } finally {
    modelsLoading.value = false
  }
}
async function loadEfforts() {
  if (effortsLoading.value) return
  effortsLoading.value = true
  try {
    efforts.value = await api<EffortList>(`/api/efforts?pane=${encodeURIComponent(props.pane.id)}`)
  } catch (err) {
    effortOpen.value = false
    toast((err as Error).message, true)
  } finally { effortsLoading.value = false }
}
watch(modelOpen, (o) => {
  if (o && (!list.value || list.value.agent !== props.pane.agent)) loadModels()
})
watch(effortOpen, (o) => { if (o && !efforts.value) loadEfforts() })
watch(() => [eventsOpen.value, props.pane.status, props.pane.model?.label, props.pane.model?.effort], () => {
  if (['claude', 'codex'].includes(props.pane.agent || '') && ['idle', 'done'].includes(props.pane.status || '') &&
      !props.pane.model?.effort && props.pane.model && !efforts.value && !why.value) loadEfforts()
}, { immediate: true })
watch(() => props.pane.id, () => { list.value = null; efforts.value = null; chosen.value = null })

const selectedModelIndex = computed(() => currentModelOption(list.value?.options || [], model.value))
const isCurrent = (o: ModelOption) => list.value?.options.indexOf(o) === selectedModelIndex.value
const displayModelOption = (o: ModelOption) => /^default \(recommended\)$/i.test(o.label) ? t('Par défaut (recommandé)') : o.label

async function choose(o: ModelOption) {
  if (isCurrent(o) || locked.value) return
  switching.value = true
  haptic()
  try {
    const r = await api<{ model: ModelInfo }>('/api/model', { pane_id: props.pane.id, label: o.label })
    chosen.value = { info: r.model, at: Date.now() }
    efforts.value = null
    toast(tl(`Modèle : ${r.model.label} (cette session)`, `Model: ${r.model.label} (this session)`))
  } catch (err) {
    toast((err as Error).message, true)
  } finally {
    switching.value = false
  }
  if (!why.value) await loadEfforts()
}

async function chooseEffort(level: string) {
  if (locked.value || model.value?.effort === level) return
  switching.value = true
  haptic()
  try {
    const r = await api<{ model: ModelInfo }>('/api/effort', { pane_id: props.pane.id, level })
    chosen.value = { info: r.model, at: Date.now() }
    if (efforts.value) efforts.value.current = level
    toast(tl(`Effort : ${level} (cette session)`, `Effort: ${level} (this session)`))
  } catch (err) { toast((err as Error).message, true) }
  finally { switching.value = false }
}

const modelItems = computed(() => {
  const head = [{ type: 'label' as const, label: t('Pour cette session seulement') }]
  if (modelsLoading.value || !list.value) {
    return [head, [{ label: t('Lecture des modèles…'), icon: 'i-lucide-loader-circle', disabled: true, class: 'model-loading' }]]
  }
  const opts = list.value.options.map(o => ({
    type: 'checkbox' as const,
    label: displayModelOption(o),
    description: o.hint || undefined,
    checked: isCurrent(o),
    onSelect: () => choose(o),
  }))
  const tail = [{
    label: t('Relire la liste'), icon: 'i-lucide-refresh-cw',
    onSelect: (e: Event) => { e.preventDefault(); loadModels(true) },
  }]
  return [head, opts, tail]
})
const effortItems = computed(() => {
  const head = [{ type: 'label' as const, label: t('Pour cette session seulement') }]
  if (effortsLoading.value || !efforts.value) return [head, [{ label: t('Lecture des efforts…'), icon: 'i-lucide-loader-circle', disabled: true }]]
  return [head, efforts.value.levels.map(level => ({
    type: 'checkbox' as const, label: level, checked: model.value?.effort === level,
    onSelect: () => chooseEffort(level),
  }))]
})
const showEffort = computed(() => ['claude', 'codex'].includes(props.pane.agent || '') &&
  Boolean(efforts.value?.levels.length || (model.value?.effort && !efforts.value)))

// Selector unavailable: the menu does not open, we explain (on the phone,
// no tooltip). The button is not `disabled` so it receives the tap.
function setOpen(which: 'model' | 'effort', v: boolean) {
  if (v && locked.value) {
    if (why.value) toast(why.value, true)
    return
  }
  if (which === 'model') { modelOpen.value = v; if (v) effortOpen.value = false }
  else { effortOpen.value = v; if (v) modelOpen.value = false }
}
watch(locked, (l) => { if (l) { modelOpen.value = false; effortOpen.value = false } })
</script>

<template>
  <UTooltip :text="why || t('Changer de modèle')" :disabled="!desk || (!why && modelOpen)" :content="{ side: 'top' }">
    <span class="model-pick-wrap">
      <UDropdownMenu
        :open="modelOpen" :items="modelItems" :modal="false"
        :content="{ side: 'top', align: 'start', sideOffset: 6 }"
        :ui="{ content: 'hw-dropdown model-menu', itemDescription: 'model-hint', label: 'model-menu-label' }"
        @update:open="setOpen('model', $event)"
      >
        <UButton
          color="neutral" variant="ghost" size="xs" class="model-pick" :class="{ off: locked }"
          :aria-disabled="locked" :aria-label="`${t('Modèle')} : ${model ? model.label : t('Modèle inconnu')}`"
          :trailing-icon="switching ? 'i-lucide-loader-circle' : 'i-lucide-chevron-down'"
          :ui="{ trailingIcon: switching ? 'animate-spin model-caret' : 'model-caret' }"
        >
          <span class="model-name">{{ model ? model.label : t('Modèle') }}</span>
        </UButton>
      </UDropdownMenu>
    </span>
  </UTooltip>
  <UTooltip v-if="showEffort" :text="why || t('Changer d’effort')" :disabled="!desk || (!why && effortOpen)" :content="{ side: 'top' }">
    <span class="model-pick-wrap">
      <UDropdownMenu
        :open="effortOpen" :items="effortItems" :modal="false"
        :content="{ side: 'top', align: 'start', sideOffset: 6 }"
        :ui="{ content: 'hw-dropdown model-menu effort-menu', label: 'model-menu-label' }"
        @update:open="setOpen('effort', $event)"
      >
        <UButton
          color="neutral" variant="ghost" size="xs" class="model-pick effort-pick" :class="{ off: locked }"
          :aria-disabled="locked" :aria-label="`${t('Effort')} : ${model?.effort || t('Effort inconnu')}`"
          :trailing-icon="switching ? 'i-lucide-loader-circle' : 'i-lucide-chevron-down'"
          :ui="{ trailingIcon: switching ? 'animate-spin model-caret' : 'model-caret' }"
        >{{ model?.effort || t('Effort') }}</UButton>
      </UDropdownMenu>
    </span>
  </UTooltip>
</template>
