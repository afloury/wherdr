<script setup lang="ts">
// Choix de la machine (feuilles « Nouvel agent » et « New project ») : un
// bouton par machine, pastille d'état ; une machine hors ligne est grisée.
import type { MachineConfig } from '#shared/types'

const props = defineProps<{ machines: MachineConfig[], modelValue: string }>()
const emit = defineEmits<{ pick: [m: MachineConfig] }>()
function pick(m: MachineConfig) {
  if (!machineOnline(m) || m.key === props.modelValue) return
  haptic()
  emit('pick', m)
}
</script>

<template>
  <div class="segmented machine-seg" :style="{ '--segment-count': machines.length }">
    <button
      v-for="m in machines" :key="m.key" type="button" :class="[{ on: m.key === modelValue }, machineStateOf(m)]"
      :disabled="!machineOnline(m)" :data-machine="m.key || 'local'" @click="pick(m)"
    >
      <UIcon :name="m.local ? 'i-lucide-server' : 'i-lucide-laptop'" class="seg-icon" />
      <span class="machine-choice-name">{{ m.label || t('Cette machine') }}</span>
      <MachineLocalBadge v-if="m.local" />
      <i class="seg-dot" />
    </button>
  </div>
</template>
