<script setup lang="ts">
import type { FileEntry, FilePreview, FilesListing } from '#shared/types'

// Read-only browser of the agent's folder: listing, then a file's text or image.
const props = defineProps<{ paneId: string }>()
const listing = ref<FilesListing | null>(null)
const preview = ref<FilePreview | null>(null)
const loading = ref(false)
const error = ref('')
const showHidden = ref(readShowHidden())
watch(showHidden, saveShowHidden)
let request = 0

const pane = () => encodeURIComponent(props.paneId)
async function load<T>(url: string, apply: (data: T) => void) {
  const id = ++request
  loading.value = true
  error.value = ''
  try {
    const data = await api<T>(url)
    if (id === request) apply(data)
  } catch (e) {
    if (id === request) error.value = (e as Error).message
  } finally {
    if (id === request) loading.value = false
  }
}
function openDir(path: string | null) {
  const q = path === null ? '' : `&path=${encodeURIComponent(path)}`
  return load<FilesListing>(`/api/files?pane=${pane()}${q}`, (d) => { listing.value = d; preview.value = null })
}
function openFile(path: string) {
  return load<FilePreview>(`/api/files/read?pane=${pane()}&path=${encodeURIComponent(path)}`, (d) => { preview.value = d })
}
const join = (name: string) => listing.value?.path ? `${listing.value.path}/${name}` : name
function open(e: FileEntry) {
  if (e.kind === 'dir') openDir(join(e.name))
  else if (e.kind === 'file') openFile(join(e.name))
}
// Back to the folder: a preview still loading must not reopen afterwards.
function back() {
  request++
  loading.value = false
  preview.value = null
}
function refresh() {
  if (preview.value) openFile(preview.value.path)
  else openDir(listing.value ? listing.value.path : null)
}
onMounted(() => openDir(null))
onUnmounted(() => { request++ })

// Breadcrumb: root folder name, then each segment of the current path.
const crumbs = computed(() => {
  const l = listing.value
  if (!l) return []
  const parts = l.path ? l.path.split('/') : []
  return [
    { label: l.root.split('/').filter(Boolean).pop() || '/', path: '' },
    ...parts.map((p, i) => ({ label: p, path: parts.slice(0, i + 1).join('/') })),
  ]
})
const entries = computed(() => (listing.value?.entries || []).filter(e => showHidden.value || !e.name.startsWith('.')))
// Text and line numbers as two blocks: a 256 kB file stays two elements.
const code = computed(() => {
  const raw = preview.value?.text ?? ''
  const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw
  let count = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  return { text, numbers: Array.from({ length: count }, (_, i) => i + 1).join('\n') }
})
function icon(e: FileEntry) {
  if (e.kind === 'dir') return e.link ? 'i-lucide-folder-symlink' : 'i-lucide-folder'
  if (e.kind === 'other') return 'i-lucide-file-question'
  return e.link ? 'i-lucide-file-symlink' : 'i-lucide-file'
}
</script>

<template>
  <div class="changes-view files-view">
    <div class="changes-inner">
      <div class="changes-toolbar">
        <nav class="files-crumbs" :aria-label="t('Folder')">
          <UButton v-if="preview" icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" :aria-label="t('Back to folder')" @click="back" />
          <template v-for="(c, i) in crumbs" :key="c.path">
            <span v-if="i" class="files-sep">/</span>
            <button type="button" class="files-crumb" @click="openDir(c.path)">{{ c.label }}</button>
          </template>
          <template v-if="preview">
            <span class="files-sep">/</span><span class="files-crumb current">{{ preview.path.split('/').pop() }}</span>
          </template>
        </nav>
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="outline" size="sm" :loading="loading" :aria-label="t('Refresh')" @click="refresh">{{ t('Refresh') }}</UButton>
      </div>

      <p v-if="error" class="changes-notice error" role="alert">{{ error }}</p>
      <p v-if="loading && !listing" class="changes-notice"><span class="spinner" /> {{ t('Reading files…') }}</p>

      <template v-else-if="preview">
        <p class="changes-location">{{ preview.path }} · {{ fmtBytes(preview.size) }}</p>
        <p v-if="preview.truncated && preview.kind === 'text'" class="changes-limit">{{ t('File truncated to keep this view responsive.') }}</p>
        <img v-if="preview.kind === 'image'" class="files-image" :src="preview.dataUrl" :alt="preview.path">
        <p v-else-if="preview.kind === 'binary'" class="changes-notice">{{ t('Binary file') }}</p>
        <p v-else-if="preview.kind === 'large'" class="changes-notice">{{ t('Image too large to preview.') }}</p>
        <div v-else class="files-code" role="region" :aria-label="preview.path">
          <pre class="files-num" aria-hidden="true">{{ code.numbers }}</pre><pre class="files-text">{{ code.text }}</pre>
        </div>
      </template>

      <template v-else-if="listing">
        <label class="changes-toggle"><input v-model="showHidden" type="checkbox"> <span>{{ t('Show hidden files') }}</span></label>
        <p v-if="listing.truncated" class="changes-limit">{{ t('File list or diff limited to keep this view responsive.') }}</p>
        <p v-if="!entries.length" class="changes-notice">{{ t('Empty folder.') }}</p>
        <ul class="files-list">
          <li v-for="e in entries" :key="e.name">
            <button type="button" class="change-file files-entry" :disabled="e.kind === 'other'" @click="open(e)">
              <UIcon :name="icon(e)" class="files-icon" :class="e.kind" />
              <span class="change-path">{{ e.name }}</span>
              <span v-if="e.kind === 'file' && e.size !== null" class="change-status">{{ fmtBytes(e.size) }}</span>
              <UIcon v-if="e.kind === 'dir'" name="i-lucide-chevron-right" class="files-chevron" />
            </button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>
