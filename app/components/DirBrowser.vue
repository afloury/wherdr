<script setup lang="ts">
// Navigateur de dossiers d'une machine, sous son HOME : parent, sous-dossiers
// (dépôts Git marqués), puis « Choisir ce dossier » (`choose`) ou `cancel`.
import type { DirListing } from '#shared/types'

const props = defineProps<{ start: string | null, machine: string }>()
const emit = defineEmits<{ choose: [path: string], cancel: [] }>()
const listing = ref<DirListing | null>(null)
const listError = ref<string | null>(null)
const listLoading = ref(false)
async function browse(p: string | null) {
  listLoading.value = true
  listError.value = null
  try { listing.value = await api<DirListing>(`/api/dirs?path=${encodeURIComponent(p || '')}${props.machine ? `&machine=${encodeURIComponent(props.machine)}` : ''}`) }
  catch (err) { listError.value = (err as Error).message }
  finally { listLoading.value = false }
}
browse(props.start)
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
        {{ t('Parent') }}
      </UButton>
      <span class="dir-path">{{ listing ? ltr(shortPath(listing.path)) : '' }}</span>
    </div>
    <div class="dir-list">
      <div v-if="listLoading" class="term-loading static"><span class="spinner" /></div>
      <p v-else-if="listError" class="form-error">{{ listError }}</p>
      <template v-else-if="listing">
        <button v-for="d in listing.dirs" :key="d.path" type="button" @click="browse(d.path)">
          <UIcon name="i-lucide-folder" /><span>{{ d.name }}</span><span v-if="d.git" class="git">git</span>
        </button>
        <p v-if="!listing.dirs.length" class="muted" style="padding:16px 8px">{{ t('Aucun sous-dossier.') }}</p>
      </template>
    </div>
    <div class="dir-actions">
      <UButton color="neutral" variant="ghost" size="lg" block @click="emit('cancel')">{{ t('Annuler') }}</UButton>
      <UButton color="primary" variant="solid" size="lg" block class="hw-cta" @click="choose">{{ t('Choisir ce dossier') }}</UButton>
    </div>
  </div>
</template>
