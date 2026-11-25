<script setup lang="ts">
// To review: every artifact of a task waiting for the user, one tap each, right under the
// step's line and below its TL;DR (TaskTodo, the task sheet's To do tab and Tasks to
// review, ReviewSheet). The URLs the step (its badge, its instructions), the latest report
// and the task's own links name open in a new tab; the files the step and the report name
// are plain links the operating system handles, no viewer of ours: from a browser on the
// task's computer a tap opens the file in its default application (POST
// /api/pm/task-file-open, xdg-open / open, like a double-click), anywhere else (a phone, another
// machine) the link downloads it (/api/files/download); the step's screenshots open in the
// image viewer, the set the gallery shows.
// One row of chips in the order they are worth opening, a thing named twice once (reviewRows).
// Files are looked for on the task's machine, in its worktree then its folder (one
// POST /api/pm/task-files per set of paths), so neither its agent nor its session need be
// open; a file that is not there is no row. While that is asked, each file is a skeleton
// row (the links are there at once); a failed ask says so and offers Try again. More than
// FOLD rows fold behind Show more. With nothing to list the block is not there at all.
import type { Card } from '#shared/pm/board'
import { workerNote } from '#shared/pm/report'
import { reviewItems } from '#shared/pm/reviewLinks'
import { filePaths, reviewRows, type ReviewRow, type TaskFile } from '#shared/pm/reviewRows'
import { shotMode } from '#shared/pm/shots'

const props = defineProps<{ card: Card }>()

// What the step tells the user to look at, what the worker reported last, the task's links.
const items = computed(() => {
  const c = props.card
  const step = c.state ? c.plan[c.state.at] : undefined
  return reviewItems({
    step: [c.yourTurn, step?.badge, step?.instructions].filter((s): s is string => !!s),
    report: c.workReports?.at(-1)?.text.trim() || (c.state ? workerNote(c.plan, c.state) : undefined),
    links: c.links,
  })
})
// The newest step's screenshots, as the gallery shows them.
const shots = computed(() => {
  const s = shotSteps(props.card)[0]
  return s ? { task: props.card.id, shots: props.card.state!.shots![s.id]!, mode: shotMode(s) } : undefined
})

// The server's answer for the files, asked again when the task or the paths change (a
// board refresh with the same paths asks nothing).
const files = computed(() => filePaths(items.value, shots.value))
const lookup = ref<{ found: Record<string, TaskFile>, failed?: true }>()
const want = computed(() => [props.card.id, ...files.value].join('\n'))
let serial = 0
async function look() {
  const mine = ++serial
  lookup.value = undefined
  if (!files.value.length) return
  try {
    const r = await api<{ found: Record<string, TaskFile> }>('/api/pm/task-files', { task: props.card.id, paths: files.value })
    if (mine === serial) lookup.value = { found: r.found }
  } catch {
    if (mine === serial) lookup.value = { found: {}, failed: true }
  }
}
watch(want, look, { immediate: true })

const rows = computed(() => reviewRows({ items: items.value, found: lookup.value?.found, shots: shots.value }))
const FOLD = 5
const all = ref(false)
// A fold hides at least two rows: Show 1 more would only be a button to press.
const folded = computed(() => !all.value && rows.value.length > FOLD + 1)
const shown = computed(() => (folded.value ? rows.value.slice(0, FOLD) : rows.value))

// Whether this browser is on the task's computer, where the OS can open a file for it.
const onThisComputer = ref(false)
if (import.meta.client) api<{ available: boolean }>('/api/pm/task-file-open').then(r => { onThisComputer.value = r.available }, () => {})
// A file's link: the raw download, which is what a click falls back to.
const fileHref = (at: TaskFile) => `/api/files/download?task=${encodeURIComponent(props.card.id)}&in=${at.root}&path=${encodeURIComponent(at.rel)}`
async function openFile(e: MouseEvent, r: Extract<ReviewRow, { kind: 'file' }>) {
  if (!r.at || !onThisComputer.value) return
  e.preventDefault()
  try {
    await api('/api/pm/task-file-open', { task: props.card.id, root: r.at.root, rel: r.at.rel })
  } catch {
    // Not a computer the OS can open it on (a remote task, no application): the download.
    window.open(fileHref(r.at), '_blank', 'noopener')
  }
}
watch(() => props.card.id, () => { all.value = false })
</script>

<template>
  <section v-if="rows.length" class="review" :aria-label="tl('To review')" data-testid="task-review">
    <span class="mono-label">{{ tl('To review') }}</span>
    <ul class="review-list">
      <li v-for="r in shown" :key="r.key">
        <a v-if="r.kind === 'url'" :href="r.url" target="_blank" rel="noopener" class="review-row" :title="r.url" data-kind="url" data-testid="task-review-row">
          <UIcon :name="r.icon" class="review-icon" />
          <span class="review-label">{{ r.label }}</span>
          <span v-if="r.host" class="review-meta mono-label">{{ r.host }}</span>
          <UIcon name="i-lucide-arrow-up-right" class="review-go" />
        </a>
        <span v-else-if="r.kind === 'file' && !r.at" class="review-row review-pending" role="status" :aria-label="tl('Loading')" aria-busy="true" data-testid="task-review-pending">
          <i class="skel review-skel" />
        </span>
        <a v-else-if="r.kind === 'file'" :href="fileHref(r.at!)" target="_blank" rel="noopener" class="review-row" :title="r.path" data-kind="file" data-testid="task-review-row" @click="openFile($event, r)">
          <UIcon :name="r.icon" class="review-icon" />
          <span class="review-label">{{ r.label }}</span>
          <span class="review-meta mono-label">{{ r.source === 'step' ? tl('Step') : tl('Report') }}</span>
          <UIcon name="i-lucide-arrow-up-right" class="review-go" />
        </a>
        <button v-else type="button" class="review-row" data-kind="shots" data-testid="task-review-row" @click="openLightbox(r.srcs, 0)">
          <UIcon :name="r.icon" class="review-icon" />
          <span class="review-label">{{ tl(`Screenshots (${r.count})`) }}</span>
          <UIcon name="i-lucide-chevron-right" class="review-go" />
        </button>
      </li>
    </ul>
    <button v-if="rows.length > FOLD + 1" type="button" class="review-more mono-label" :aria-expanded="!folded" data-testid="task-review-more" @click="all = !all">
      {{ folded ? tl(`Show ${rows.length - FOLD} more`) : tl('Show less') }}
    </button>
    <p v-if="lookup?.failed" class="review-failed muted" role="status" data-testid="task-review-failed">
      <span>{{ tl('The files this task names could not be checked.') }}</span>
      <button type="button" class="review-more mono-label" data-testid="task-review-retry" @click="look">{{ tl('Try again') }}</button>
    </p>
  </section>
</template>

<style scoped>
.review { display: grid; gap: 6px; min-width: 0; }
/* Each artifact is its own chip, wrapping inline: no box around them. */
.review-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.review-list > li { min-width: 0; max-width: 100%; }
.review-row { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-width: 0; min-height: 32px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--text); font: inherit; text-align: left; text-decoration: none; cursor: pointer; }
.review-row:hover { background: var(--surface-2); }
.review-row:focus-visible { outline: 1px solid var(--mauve); outline-offset: 1px; }
.review-icon { flex: none; width: 14px; height: 14px; color: var(--text-3); }
.review-go { flex: none; width: 12px; height: 12px; color: var(--muted); }
.review-label { min-width: 0; overflow-wrap: anywhere; }
.review-meta { flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere; color: var(--muted); }
/* A file still being looked for: the width of a name, no hover, nothing to press. */
.review-pending { cursor: default; }
.review-pending:hover { background: var(--surface); }
.review-skel { width: 90px; height: 14px; }
.review-more { justify-self: start; min-height: 32px; padding: 0; border: 0; background: none; color: var(--accent); cursor: pointer; }
.review-more:hover { text-decoration: underline; }
.review-failed { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin: 0; overflow-wrap: anywhere; }
/* On the phone, and for any touch, every chip and button is a 44 px target. */
@media (max-width: 699px), (pointer: coarse) {
  .review-row { min-height: 44px; }
  .review-more { min-height: 44px; }
}
</style>
