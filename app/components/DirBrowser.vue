<script setup lang="ts">
// Folder browser of a machine, under its HOME: parent, subfolders
// (Git repositories marked), then "Choose this folder" (`choose`) or `cancel`.
// At the top, the current path is editable: paste/type a path + Enter opens it.
import type { DirListing } from '#shared/types'
import { normalizeDirInput } from '~/utils/dirInput'

const props = defineProps<{ start: string | null, machine: string }>()
const emit = defineEmits<{ choose: [path: string], cancel: [] }>()
const listing = ref<DirListing | null>(null)
const listError = ref<string | null>(null)
const listLoading = ref(false)
const pathInput = ref('')
const pathError = ref<string | null>(null)
async function fetchDir(p: string | null) {
  return api<DirListing>(`/api/dirs?path=${encodeURIComponent(p || '')}${props.machine ? `&machine=${encodeURIComponent(props.machine)}` : ''}`)
}
function show(l: DirListing) {
  listing.value = l
  pathInput.value = shortPath(l.path)
  pathError.value = null
}
async function browse(p: string | null) {
  listLoading.value = true
  listError.value = null
  try { show(await fetchDir(p)) }
  catch (err) { listError.value = (err as Error).message }
  finally { listLoading.value = false }
}
browse(props.start)

// Typed path: the displayed list stays in place as long as the new folder
// is not open; an error shows below the field, the sheet stays open.
const going = ref(false)
async function go() {
  const raw = pathInput.value.trim()
  const home = listing.value?.home
  const target = home ? normalizeDirInput(raw, home) : raw
  if (target === null) {
    pathError.value = tl(`This folder is outside this machine’s home folder (${shortPath(home)}).`, `Ce dossier est hors du dossier personnel (${shortPath(home)}) de cette machine.`)
    return
  }
  going.value = true
  try { show(await fetchDir(target)) }
  catch (err) {
    const e = err as ApiError
    pathError.value = e.code === 'bad_path'
      ? tl('Folder not found or unreadable on this machine.', 'Dossier introuvable ou illisible sur cette machine.')
      : e.message
  }
  finally { going.value = false }
}
function choose() {
  if (listing.value) emit('choose', listing.value.path)
  else emit('cancel')
}
</script>

<template>
  <div class="dir-browser">
    <div class="dir-top">
      <UButton
        size="sm" color="neutral" variant="ghost" icon="i-lucide-chevron-left" :class="{ invisible: !listing?.parent }"
        :disabled="!listing?.parent" @click="browse(listing?.parent || null)"
      >
        <span class="dir-parent-label">{{ t('Parent') }}</span>
      </UButton>
      <form class="dir-go" @submit.prevent="go">
        <input
          v-model="pathInput" class="dir-input" type="text" inputmode="url" enterkeyhint="go"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
          :aria-label="tl('Folder path', 'Chemin du dossier')" placeholder="~/…"
          :aria-invalid="!!pathError" @input="pathError = null"
        >
        <UButton
          type="submit" size="sm" color="neutral" variant="outline" icon="i-lucide-arrow-right"
          :loading="going" :aria-label="tl('Go', 'Aller')" :title="tl('Go', 'Aller')"
        />
      </form>
    </div>
    <p v-if="pathError" class="form-error dir-go-error">{{ pathError }}</p>
    <div class="dir-list">
      <div v-if="listLoading" class="term-loading static"><span class="spinner" /></div>
      <p v-else-if="listError" class="form-error">{{ listError }}</p>
      <template v-else-if="listing">
        <button v-for="d in listing.dirs" :key="d.path" type="button" @click="browse(d.path)">
          <UIcon name="i-lucide-folder" /><span>{{ d.name }}</span><span v-if="d.git" class="git">git</span>
        </button>
        <p v-if="!listing.dirs.length" class="muted" style="padding:16px 8px">{{ t('No subfolders.') }}</p>
      </template>
    </div>
    <div class="dir-actions">
      <UButton color="neutral" variant="ghost" size="lg" block @click="emit('cancel')">{{ t('Cancel') }}</UButton>
      <UButton color="primary" variant="solid" size="lg" block class="hw-cta" @click="choose">{{ t('Choose this folder') }}</UButton>
    </div>
  </div>
</template>
