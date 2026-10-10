<script setup lang="ts">
import type { ChangeFile, ChangesResponse } from '#shared/types'
import { composeReview, matchesReview, missingReviews, type ReviewComment, type ReviewLine } from '#shared/review'

const props = defineProps<{ paneId: string }>()
const emit = defineEmits<{ review: [text: string] }>()
const comments = useReviewDraft(props.paneId)
const missing = computed(() => changes.value ? missingReviews(comments.value, changes.value, includeCommits.value) : [])
const countComments = computed(() => comments.value.filter(c => c.body.trim()).length)
function update(id: string, body: string) { const c = comments.value.find(c => c.id === id); if (c) c.body = body }
function remove(id: string) { comments.value = comments.value.filter(c => c.id !== id) }
async function add(scope: ReviewComment['scope'], path: string, line: ReviewLine) {
  let c = comments.value.find(c => c.scope === scope && c.path === path && matchesReview(c, line))
  if (!c) {
    c = { id: crypto.randomUUID(), scope, path, number: line.number!, side: line.side, text: line.text, body: '' }
    comments.value.push(c)
  }
  await nextTick()
  document.getElementById(`review-${c.id}`)?.focus()
}
function sendReview() {
  const text = composeReview(comments.value, t('Please review these points:'), t('old line'), t('line no longer in diff'), missing.value.map(c => c.id))
  if (!text) return
  emit('review', text)
  comments.value = []
}
const changes = ref<ChangesResponse | null>(null)
const loading = ref(false)
const error = ref('')
const includeCommits = ref(comments.value.some(c => c.scope === 'committed'))
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
  if (f.status === '??') return t('Untracked')
  if (f.status === 'commit') return t('Commit')
  if (f.status.includes('R')) return t('Renamed')
  if (f.status.includes('D')) return t('Deleted')
  if (f.status.includes('A')) return t('Added')
  return t('Modified')
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
        <UButton icon="i-lucide-refresh-cw" color="neutral" variant="outline" size="sm" :loading="loading" :aria-label="t('Refresh changes')" @click="refresh">{{ t('Refresh') }}</UButton>
      </div>

      <div v-if="comments.length" class="review-toolbar">
        <span role="status">{{ countComments }} {{ t(countComments === 1 ? 'review comment' : 'review comments') }}</span>
        <UButton color="neutral" variant="outline" @click="comments = []">{{ t('Discard') }}</UButton>
        <UButton :disabled="!countComments" @click="sendReview">{{ t('Send review') }}</UButton>
        <p>{{ t('Adds to your message draft. You send it yourself.') }}</p>
      </div>
      <ReviewNote v-for="note in missing" :key="note.id" :comment="note" missing @update="update" @remove="remove" />
      <p v-if="error" class="changes-notice error" role="alert">{{ error }}</p>
      <p v-if="loading && !changes" class="changes-notice"><span class="spinner" /> {{ t('Reading changes…') }}</p>
      <p v-else-if="changes && !changes.git" class="changes-notice">{{ t('This folder is not a Git repository.') }}</p>
      <template v-else-if="changes?.git">
        <section class="changes-section">
          <h3>{{ t('Working tree') }} <span>{{ changes.working?.count || 0 }}</span></h3>
          <p v-if="!changes.working?.count" class="changes-notice">{{ t('No working tree changes.') }}</p>
          <template v-else>
            <p v-if="changes.working?.truncated" class="changes-limit">{{ t('File list or diff limited to keep this view responsive.') }}</p>
            <details v-for="f in changes.working?.files" :key="f.path" class="change-file">
              <summary>
                <span class="change-path">{{ f.path }}</span>
                <span v-if="f.binary" class="change-binary">{{ t('Binary') }}</span>
                <span v-else class="change-totals"><b>{{ count(f.added, '+') }}</b><i>{{ count(f.deleted, '−') }}</i></span>
                <span class="change-status">{{ status(f) }}</span>
              </summary>
              <p v-if="f.previousPath" class="change-note">{{ t('From') }} {{ f.previousPath }}</p>
              <p v-if="f.summary" class="change-note">{{ t(f.summary) }}</p>
              <ReviewDiff v-if="f.lines.length" :file="f" scope="working" :comments="comments" @add="add" @update="update" @remove="remove" />
            </details>
          </template>
        </section>

        <section class="changes-section">
          <label class="changes-toggle"><input v-model="includeCommits" type="checkbox"> <span>{{ t('Also show unpushed commits') }}</span></label>
          <template v-if="includeCommits && changes.committed">
            <h3>{{ t('Commits') }} <span>{{ changes.commits ?? 0 }}</span></h3>
            <p class="changes-location">{{ changes.comparison }} → HEAD</p>
            <p v-if="changes.committed.truncated" class="changes-limit">{{ t('File list or diff limited to keep this view responsive.') }}</p>
            <p v-if="!changes.committed.count" class="changes-notice">{{ t('No committed changes to show.') }}</p>
            <details v-for="f in changes.committed.files" :key="f.path" class="change-file">
              <summary>
                <span class="change-path">{{ f.path }}</span>
                <span v-if="f.binary" class="change-binary">{{ t('Binary') }}</span>
                <span v-else class="change-totals"><b>{{ count(f.added, '+') }}</b><i>{{ count(f.deleted, '−') }}</i></span>
              </summary>
              <p v-if="f.summary" class="change-note">{{ t(f.summary) }}</p>
              <ReviewDiff v-if="f.lines.length" :file="f" scope="committed" :comments="comments" @add="add" @update="update" @remove="remove" />
            </details>
          </template>
          <p v-else-if="includeCommits && !loading && !changes.comparison" class="changes-notice">{{ t('No upstream or base branch available for comparison.') }}</p>
        </section>
      </template>
    </div>
  </div>
</template>
