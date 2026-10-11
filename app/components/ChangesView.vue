<script setup lang="ts">
import type { ChangeFile, ChangesResponse } from '#shared/types'
import { commentSpan, composeReview, freshReviews, missingReviews, reviewBlock, reviewSpan, reviewText, sameBlock, spanLabel, type ReviewAction, type ReviewComment, type ReviewLine, type ReviewSelection } from '#shared/review'

const props = defineProps<{ paneId: string }>()
const emit = defineEmits<{ review: [text: string] }>()
const comments = useReviewDraft(props.paneId)
const missing = computed(() => changes.value ? missingReviews(comments.value, changes.value, includeCommits.value) : [])
// An editor still open counts with what it holds: Send review never drops written text.
const countComments = computed(() => comments.value.filter(reviewText).length)
const words = computed(() => ({ line: t('Line'), lines: t('Lines'), oldLine: t('old line'), oldLines: t('old lines') }))
// The block being chosen in one of the diffs, before its comment exists.
const selection = ref<ReviewSelection | null>(null)
const selectionLabel = computed(() => selection.value ? spanLabel(reviewSpan(selection.value.block), words.value) : '')
function focusNote(id: string) { nextTick(() => document.getElementById(`review-${id}`)?.focus()) }
function remove(id: string) { comments.value = comments.value.filter(c => c.id !== id) }
function act(action: ReviewAction, id: string, text?: string) {
  const c = comments.value.find(c => c.id === id)
  if (!c) return
  if (action === 'draft') c.draft = text ?? ''
  else if (action === 'edit') { c.draft = c.body; focusNote(id) }
  else if (action === 'save' && reviewText(c)) { c.body = reviewText(c); delete c.draft }
  else if (action === 'cancel' && c.body) delete c.draft
  else remove(id)
}
// A comment on the block: the one already there if any, else a new one. With
// `extend`, the block of that open comment changes instead.
function add(scope: ReviewComment['scope'], path: string, block: ReviewLine[], extend?: string) {
  if (!block.some(l => l.number !== null)) return
  const at = reviewBlock(block)
  let c = comments.value.find(c => extend ? c.id === extend : c.scope === scope && c.path === path && sameBlock(c, at))
  if (c && extend) Object.assign(c, at)
  else if (c) c.draft ??= c.body
  else {
    c = { id: crypto.randomUUID(), scope, path, ...at, body: '', draft: '' }
    comments.value.push(c)
  }
  selection.value = null
  focusNote(c.id)
}
function sendReview() {
  const fresh = changes.value ? freshReviews(comments.value, changes.value) : comments.value
  const text = composeReview(fresh, { intro: t('Please review these points:'), oldLine: t('old line'), oldLines: t('old lines'), missing: t('no longer in diff') }, missing.value.map(c => c.id))
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
// Row indexes belong to the diff they were read in.
watch(changes, () => { selection.value = null })
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
      <p v-if="changes?.git && !comments.length" class="review-hint">
        <span class="by-mouse">{{ t('To comment, hover a line and click +. Drag from the + to comment a block of lines.') }}</span>
        <span class="by-touch">{{ t('To comment, tap a line number, then another line for a block.') }}</span>
      </p>

      <div v-if="comments.length" class="review-toolbar">
        <span role="status">{{ countComments }} {{ t(countComments === 1 ? 'review comment' : 'review comments') }}</span>
        <UButton color="neutral" variant="outline" @click="comments = []">{{ t('Discard') }}</UButton>
        <UButton :disabled="!countComments" @click="sendReview">{{ t('Send review') }}</UButton>
        <p>{{ t('Adds to your message draft. You send it yourself.') }}</p>
      </div>
      <ReviewNote v-for="note in missing" :key="note.id" :comment="note" :label="spanLabel(commentSpan(note), words)" missing @act="act" />
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
              <ReviewDiff v-if="f.lines.length" :file="f" scope="working" :comments="comments" :selection="selection" @add="add" @select="selection = $event" @act="act" />
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
              <ReviewDiff v-if="f.lines.length" :file="f" scope="committed" :comments="comments" :selection="selection" @add="add" @select="selection = $event" @act="act" />
            </details>
          </template>
          <p v-else-if="includeCommits && !loading && !changes.comparison" class="changes-notice">{{ t('No upstream or base branch available for comparison.') }}</p>
        </section>
      </template>
      <p class="sr-only" role="status">{{ selectionLabel && `${t('Selection:')} ${selectionLabel}` }}</p>
      <div v-if="selection && selection.via !== 'drag'" class="review-pick">
        <div>
          <b>{{ selectionLabel }}</b>
          <p>{{ selection.via === 'touch' ? t('Tap another line of this hunk to extend the block.') : t('Shift+Arrow extends the block within this hunk.') }}</p>
        </div>
        <button type="button" class="review-btn" @click="selection = null">{{ t('Cancel') }}</button>
        <button type="button" class="review-btn primary" @click="add(selection.scope, selection.path, selection.block)">{{ t('Comment') }}</button>
      </div>
    </div>
  </div>
</template>
