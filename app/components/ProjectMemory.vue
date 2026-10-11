<script setup lang="ts">
// "Memory" tab of the Project panel: the project's memory files (MEMORY.md,
// the index, then the files of memory/ with the title and hook the index
// gives them). A tap opens one, rendered as Markdown in its `plain` mode: a
// file's raw HTML cannot restyle the app or draw controls over it. Read-only:
// memory is written by the coordinator, never from here.
// Re-read when the panel is refreshed (`tick`) or the board changes.
import type { ProjectBoard } from '#shared/projectBoard'
import type { MemoryFile } from '#shared/projectDocs'
import { md } from '~/utils/markdown'

const props = defineProps<{ paneId: string, board: ProjectBoard, tick: number }>()

const files = shallowRef<MemoryFile[] | null>(null)
const loading = ref(false)
const error = ref('')
let seq = 0
async function load() {
  if (offlineView.value) return
  const id = ++seq
  loading.value = true
  try {
    const r = await fetchProjectMemory(props.paneId)
    if (id !== seq) return
    files.value = r.files
    error.value = ''
  } catch (e) {
    if (id === seq) error.value = (e as Error).message
  } finally {
    if (id === seq) loading.value = false
  }
}
onMounted(load)
watch(() => [props.tick, props.board.version], load)
onUnmounted(() => { seq++ })

const doc = ref<{ file: MemoryFile, html: string, truncated: boolean } | null>(null)
const docOpen = ref(false)
const opening = ref<string | null>(null)
async function open(file: MemoryFile) {
  if (opening.value) return
  if (file.missing) return toast(tl('This file is listed in MEMORY.md but does not exist', 'Ce fichier est cité dans MEMORY.md mais n’existe pas'), true)
  opening.value = file.name
  haptic()
  try {
    const r = await fetchMemoryFile(props.paneId, file.name)
    doc.value = { file, html: md(r.text, { plain: true }), truncated: r.truncated }
    docOpen.value = true
  } catch (e) { toast((e as Error).message, true) }
  finally { opening.value = null }
}
</script>

<template>
  <div class="pm">
    <p v-if="error" class="pp-notice error" role="alert">
      <span>{{ tl('Memory unavailable', 'Mémoire indisponible') }} · <code>{{ error }}</code></span>
      <UButton size="xs" color="neutral" variant="outline" @click="load">{{ tl('Retry', 'Réessayer') }}</UButton>
    </p>
    <p v-if="files === null && loading" class="pp-notice"><span class="spinner" /> {{ tl('Reading the memory…', 'Lecture de la mémoire…') }}</p>
    <template v-if="files">
      <p v-if="!files.length" class="pp-empty pi-none">{{ tl('No memory in this project yet', 'Pas encore de mémoire dans ce projet') }}</p>
      <ul v-else class="pp-list pm-list">
        <li v-for="f in files" :key="f.name" class="pp-row">
          <div class="pp-card pm-card" :class="{ missing: f.missing, index: f.index }">
            <button type="button" class="pp-thread pm-file" :aria-label="tl(`Memory: ${f.title}`, `Mémoire : ${f.title}`)" @click="open(f)">
              <span class="pp-thread-title">{{ f.index ? tl('Index', 'Index') : f.title }}</span>
              <span v-if="f.hook" class="pm-hook">{{ f.hook }}</span>
              <span class="pp-meta">{{ f.index ? f.name : `memory/${f.name}` }}{{ f.missing ? tl(' · missing', ' · absent') : '' }}</span>
            </button>
            <span v-if="opening === f.name" class="spinner pp-spin" />
            <UIcon v-else name="i-lucide-chevron-right" class="pt-go" />
          </div>
        </li>
      </ul>
      <p v-if="files.length" class="pp-empty ps-note">{{ tl('Read-only. The coordinator writes the project’s memory.', 'Lecture seule. La mémoire du projet est écrite par le coordinateur.') }}</p>
    </template>

    <AppSheet v-model:open="docOpen" :title="doc ? (doc.file.index ? doc.file.name : doc.file.title) : ''" wide tall screen>
      <div v-if="doc" class="pp-report pm-doc">
        <p class="pp-meta pm-path">{{ doc.file.index ? doc.file.name : `memory/${doc.file.name}` }}</p>
        <div class="md"><ChatMarkdown :html="doc.html" :typing="null" /></div>
        <p v-if="doc.truncated" class="pp-notice">{{ tl('File truncated (too long).', 'Fichier tronqué (trop long).') }}</p>
      </div>
    </AppSheet>
  </div>
</template>
