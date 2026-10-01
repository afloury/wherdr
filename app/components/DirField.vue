<script setup lang="ts">
// Folder field: button opening the browser (`browse`), chips of recent
// folders; `clearable` adds a cross that empties the field (value '').
const model = defineModel<string | null>({ required: true })
defineProps<{ recents: string[], placeholder?: string, clearable?: boolean }>()
const emit = defineEmits<{ browse: [] }>()
</script>

<template>
  <div class="dir-field">
    <button type="button" class="dir-pick" :class="{ unset: !model }" @click="emit('browse')">
      <UIcon name="i-lucide-folder" />
      <span>{{ model ? ltr(shortPath(model)) : placeholder }}</span>
      <UIcon name="i-lucide-chevron-right" class="chev" />
    </button>
    <button v-if="clearable && model" type="button" class="dir-clear" :aria-label="tl('Clear', 'Vider')" :title="tl('Clear', 'Vider')" @click="model = ''">
      <UIcon name="i-lucide-x" />
    </button>
  </div>
  <div v-if="recents.length" class="chips">
    <button v-for="d in recents" :key="d" type="button" :class="{ on: d === model }" @click="model = d">{{ shortPath(d).split('/').pop() || '~' }}</button>
  </div>
</template>
