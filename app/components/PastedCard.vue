<script setup lang="ts">
// Long pasted text in a sent message as a card ("Pasted text · N lines",
// first two lines as a preview), like Claude Desktop. A tap opens the whole
// text (PastedSheet). In the message field it is a tile (AttachTile).
import { lineCount } from '#shared/pastedText'

const props = defineProps<{ text: string }>()
const open = ref(false)
const lines = computed(() => lineCount(props.text))
const preview = computed(() => props.text.split('\n').filter(l => l.trim()).slice(0, 2).map(l => l.trim()))
const title = computed(() => tl(`Pasted text · ${lines.value} line${lines.value > 1 ? 's' : ''}`, `Texte collé · ${lines.value} ligne${lines.value > 1 ? 's' : ''}`))
</script>

<template>
  <div class="pasted-card">
    <button type="button" class="pasted-open" :aria-label="tl('Open pasted text', 'Ouvrir le texte collé')" @click="open = true">
      <span class="pasted-head"><UIcon name="i-lucide-clipboard-paste" />{{ title }}</span>
      <span v-for="(l, i) in preview" :key="i" class="pasted-line">{{ l }}</span>
    </button>
    <PastedSheet v-model:open="open" :text="text" />
  </div>
</template>
