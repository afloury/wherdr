<script setup lang="ts" generic="V extends string">
// One choice among 2 to 4 in Settings: a segmented UToggleGroup in wherdr's
// style (main.css, `.hw-seg`), with the chosen option's description under it.
// A tap on the chosen option keeps it (a single toggle group would clear it).
// Long lists stay a select, on/off stays a switch.
export interface SettingsChoiceItem<T extends string = string> { label: string, value: T, icon?: string, description?: string, disabled?: boolean }
const props = defineProps<{ items: SettingsChoiceItem<V>[], label: string, disabled?: boolean }>()
const model = defineModel<V | undefined>()
const buttons = computed(() => props.items.map(i => ({ label: i.label, value: i.value, icon: i.icon, disabled: i.disabled, 'data-value': i.value })))
const description = computed(() => props.items.find(i => i.value === model.value)?.description)
function pick(v: unknown) { if (typeof v === 'string' && v) model.value = v as V }
</script>

<template>
  <div class="hw-seg-wrap">
    <UToggleGroup
      :model-value="model" :items="buttons" :disabled="disabled" :aria-label="label"
      class="hw-seg" :style="{ '--segment-count': items.length }" @update:model-value="pick"
    />
    <small v-if="description" class="hw-seg-desc">{{ description }}</small>
  </div>
</template>
