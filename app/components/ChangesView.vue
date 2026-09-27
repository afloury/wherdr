<script setup lang="ts">
import type { ChangeFile, ChangesResponse } from '#shared/types'

const props = defineProps<{ paneId: string }>()
const changes = ref<ChangesResponse | null>(null)
const loading = ref(false)
const error = ref('')
const includeCommits = ref(false)
let request = 0

async function refresh() {
  const id = ++request
  loading.value = true
  error.value = ''
  try {
    const data = await api<ChangesResponse>(`/api/changes?pane=${encodeURIComponent(props.paneId)}&commits=${includeCommits.value ? '1' : '0'}`)
    if (id === request) changes.value = data
  } catch (e) {
    if (id === request) error.value = (e as Error).message
  } finally {
    if (id === request) loading.value = false
  }
}
onMounted(refresh)
watch(includeCommits, refresh)
onUnmounted(() => { request++ })

function status(f: ChangeFile) {
  if (f.status === '??') return t('Non suivi')
  if (f.status === 'commit') return t('Commit')
  if (f.status.includes('R')) return t('Renommé')
  if (f.status.includes('D')) return t('Supprimé')
  if (f.status.includes('A')) return t('Ajouté')
  return t('Modifié')
}
function count(n: number | null, sign: string) { return n === null ? `${sign}—` : `${sign}${n}` }
</script>

<template>
  <div class="changes-view">
    <div class="changes-inner">
      <div class="changes-toolbar">
        <div>
          <p v-if="changes?.git" class="changes-location">{{ changes.branch || 'HEAD' }} · {{ changes.root }}</p>
        </div>
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="outline" size="sm" :loading="loading" :aria-label="t('Rafraîchir les changements')" @click="refresh">{{ t('Rafraîchir') }}</UButton>
      </div>

      <p v-if="error" class="changes-notice error" role="alert">{{ error }}</p>
      <p v-if="loading && !changes" class="changes-notice"><span class="spinner" /> {{ t('Lecture des changements…') }}</p>
      <p v-else-if="changes && !changes.git" class="changes-notice">{{ t('Ce dossier n’est pas un dépôt Git.') }}</p>
      <template v-else-if="changes?.git">
        <section class="changes-section">
          <h3>{{ t('Dossier de travail') }} <span>{{ changes.working?.count || 0 }}</span></h3>
          <p v-if="!changes.working?.count" class="changes-notice">{{ t('Aucun changement dans le dossier de travail.') }}</p>
          <template v-else>
            <p v-if="changes.working?.truncated" class="changes-limit">{{ t('Liste ou diff limité pour garder la vue rapide.') }}</p>
            <details v-for="f in changes.working?.files" :key="f.path" class="change-file">
              <summary>
                <span class="change-path">{{ f.path }}</span>
                <span v-if="f.binary" class="change-binary">{{ t('Binaire') }}</span>
                <span v-else class="change-totals"><b>{{ count(f.added, '+') }}</b><i>{{ count(f.deleted, '−') }}</i></span>
                <span class="change-status">{{ status(f) }}</span>
              </summary>
              <p v-if="f.previousPath" class="change-note">{{ t('Depuis') }} {{ f.previousPath }}</p>
              <p v-if="f.summary" class="change-note">{{ t(f.summary) }}</p>
              <div v-if="f.lines.length" class="change-code" role="region" :aria-label="f.path">
                <div v-for="(line, i) in f.lines" :key="i" class="change-line" :class="line.kind">{{ line.text }}</div>
              </div>
            </details>
          </template>
        </section>

        <section class="changes-section">
          <label class="changes-toggle"><input v-model="includeCommits" type="checkbox"> <span>{{ t('Voir aussi les commits non poussés') }}</span></label>
          <template v-if="includeCommits && changes.committed">
            <h3>{{ t('Commits') }} <span>{{ changes.commits ?? 0 }}</span></h3>
            <p class="changes-location">{{ changes.comparison }} → HEAD</p>
            <p v-if="changes.committed.truncated" class="changes-limit">{{ t('Liste ou diff limité pour garder la vue rapide.') }}</p>
            <p v-if="!changes.committed.count" class="changes-notice">{{ t('Aucun changement commité à afficher.') }}</p>
            <details v-for="f in changes.committed.files" :key="f.path" class="change-file">
              <summary>
                <span class="change-path">{{ f.path }}</span>
                <span v-if="f.binary" class="change-binary">{{ t('Binaire') }}</span>
                <span v-else class="change-totals"><b>{{ count(f.added, '+') }}</b><i>{{ count(f.deleted, '−') }}</i></span>
              </summary>
              <p v-if="f.summary" class="change-note">{{ t(f.summary) }}</p>
              <div v-if="f.lines.length" class="change-code" role="region" :aria-label="f.path">
                <div v-for="(line, i) in f.lines" :key="i" class="change-line" :class="line.kind">{{ line.text }}</div>
              </div>
            </details>
          </template>
          <p v-else-if="includeCommits && !loading && !changes.comparison" class="changes-notice">{{ t('Aucun amont ou branche de base disponible pour comparer.') }}</p>
        </section>
      </template>
    </div>
  </div>
</template>
