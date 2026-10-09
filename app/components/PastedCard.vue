<script setup lang="ts">
// Long pasted text as an attachment card ("Pasted text · N lines", first two
// lines as a preview), like Claude Desktop. A tap opens the whole text in a
// scrolling window (sheet on the phone), monospace for a log, with Copy.
import { lineCount, looksLikeLog } from '#shared/pastedText'

const props = defineProps<{ text: string, removable?: boolean }>()
const emit = defineEmits<{ remove: [] }>()
const open = ref(false)
const lines = computed(() => lineCount(props.text))
const preview = computed(() => props.text.split('\n').filter(l => l.trim()).slice(0, 2).map(l => l.trim()))
const mono = computed(() => looksLikeLog(props.text))
const title = computed(() => tl(`Pasted text · ${lines.value} line${lines.value > 1 ? 's' : ''}`, `Texte collé · ${lines.value} ligne${lines.value > 1 ? 's' : ''}`))
async function copy() {
  try {
    await navigator.clipboard.writeText(props.text)
    toast(tl('Text copied', 'Texte copié'))
  } catch { toast(t('Copy failed'), true) }
}
</script>

<template>
  <div class="pasted-card" :class="{ removable }">
    <button type="button" class="pasted-open" :aria-label="tl('Open pasted text', 'Ouvrir le texte collé')" @click="open = true">
      <span class="pasted-head"><UIcon name="i-lucide-clipboard-paste" />{{ title }}</span>
      <span v-for="(l, i) in preview" :key="i" class="pasted-line">{{ l }}</span>
    </button>
    <button v-if="removable" type="button" class="pasted-x" :aria-label="t('Remove')" @click.stop="emit('remove')">
      <UIcon name="i-lucide-x" />
    </button>
    <AppSheet v-model:open="open" :title="title" wide tall>
      <pre class="pasted-full" :class="{ mono }">{{ text }}</pre>
      <template #footer>
        <div class="pasted-foot">
          <UButton icon="i-lucide-copy" color="neutral" variant="outline" @click="copy">{{ tl('Copy', 'Copier') }}</UButton>
        </div>
      </template>
    </AppSheet>
  </div>
</template>
