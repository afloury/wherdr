<script setup lang="ts">
// The diff of one file, with review comments on a line or on a block of lines.
// Code is plain text: a click on it does nothing, so it can be selected and
// copied. Comments start from the gutter:
// - mouse: "+" on the hovered line; press and drag over other lines for a
//   block, or Shift+click another line while the editor is open;
// - touch: tap a line number, tap another line to extend, then Comment in the
//   bar pinned at the bottom (ChangesView);
// - keyboard: arrows move between lines, Shift+arrows choose a block, Enter comments.
// A block stays inside one hunk: the other hunks dim while one is being chosen.
import type { ChangeFile } from '#shared/types'
import { clampBlock, commentSpan, hunkRange, locateReview, reviewLines, reviewSpan, spanLabel, type ReviewAction, type ReviewComment, type ReviewLine, type ReviewSelection } from '#shared/review'

const props = defineProps<{ file: ChangeFile, scope: ReviewComment['scope'], comments: ReviewComment[], selection?: ReviewSelection | null }>()
const emit = defineEmits<{
  add: [scope: ReviewComment['scope'], path: string, block: ReviewLine[], extend?: string]
  select: [selection: ReviewSelection | null]
  act: [action: ReviewAction, id: string, text?: string]
}>()
const root = ref<HTMLElement | null>(null)
const hint = useId()
const lines = computed(() => reviewLines(props.file.lines))
const words = computed(() => ({ line: t('Line'), lines: t('Lines'), oldLine: t('old line'), oldLines: t('old lines') }))

// Where each comment of this file sits in the diff, and which rows it covers.
const hovered = ref<string | null>(null)
const placed = computed(() => props.comments.flatMap((c) => {
  const at = c.scope === props.scope && c.path === props.file.path ? locateReview(c, lines.value) : null
  return at ? [{ c, at }] : []
}))
const marks = computed(() => {
  const notes = new Map<number, ReviewComment[]>()
  const open = new Set<number>()
  const noted = new Set<number>()
  for (const { c, at } of placed.value) {
    notes.set(at[1], [...(notes.get(at[1]) ?? []), c])
    const rows = c.draft !== undefined || c.id === hovered.value ? open : noted
    for (let i = at[0]; i <= at[1]; i++) rows.add(i)
  }
  return { notes, open, noted }
})
function label(c: ReviewComment) {
  const at = placed.value.find(p => p.c.id === c.id)?.at
  return spanLabel(at ? reviewSpan(lines.value.slice(at[0], at[1] + 1)) : commentSpan(c), words.value)
}

const sel = computed(() => props.selection && props.selection.scope === props.scope && props.selection.path === props.file.path ? props.selection : null)
const picked = computed(() => sel.value ? [Math.min(sel.value.anchor, sel.value.head), Math.max(sel.value.anchor, sel.value.head)] as const : null)
const hunk = computed(() => sel.value ? hunkRange(lines.value, sel.value.anchor) : null)
function select(anchor: number, head: number, via: ReviewSelection['via']) {
  const at = clampBlock(lines.value, anchor, head)
  emit('select', { scope: props.scope, path: props.file.path, anchor, head: at[0] === anchor ? at[1] : at[0], via, block: lines.value.slice(at[0], at[1] + 1) })
  return at
}
function comment(a: number, b: number, extend?: string) {
  emit('add', props.scope, props.file.path, lines.value.slice(a, b + 1), extend)
  emit('select', null)
}

// Mouse: the block follows the pointer from the pressed gutter to the row
// under it, and the editor opens on release. Shift+press extends the block of
// the open editor instead.
let pointer = ''
function seen(e: PointerEvent) { pointer = e.pointerType }
let drag: { anchor: number, at: [number, number], extend?: string } | null = null
function rowAt(y: number) {
  const box = root.value?.getBoundingClientRect()
  const row = box && document.elementFromPoint(box.left + 4, y)?.closest<HTMLElement>('[data-row]')
  return row && root.value!.contains(row) ? Number(row.dataset.row) : null
}
function move(e: PointerEvent) {
  const i = rowAt(e.clientY)
  if (drag && i !== null && lines.value[i]?.number != null) drag.at = select(drag.anchor, i, 'drag')
}
function stopDrag() {
  drag = null
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', up)
  window.removeEventListener('pointercancel', abort)
  window.removeEventListener('keydown', abortKey, true)
}
function up() {
  const d = drag
  stopDrag()
  if (d) comment(d.at[0], d.at[1], d.extend)
}
function abort() { stopDrag(); emit('select', null) }
function abortKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  abort()
}
function down(e: PointerEvent, i: number) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return
  // No text selection while a block is dragged; the gutter keeps the focus.
  e.preventDefault()
  ;(e.currentTarget as HTMLElement).focus()
  const [a, b] = hunkRange(lines.value, i)
  const open = e.shiftKey ? placed.value.findLast(p => p.c.draft !== undefined && p.at[0] >= a && p.at[1] <= b) : undefined
  const anchor = open ? (i >= open.at[0] ? open.at[0] : open.at[1]) : i
  drag = { anchor, at: select(anchor, i, 'drag'), extend: open?.c.id }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', abort)
  window.addEventListener('keydown', abortKey, true)
}
onUnmounted(stopDrag)

// Touch: a first tap chooses a line, the next one the other end of the block.
// Tapping the only chosen line again lets go of it.
function tap(i: number) {
  const s = sel.value
  const h = hunk.value
  if (!s || !h || s.via === 'drag' || i < h[0] || i > h[1]) select(i, i, 'touch')
  else if (i === s.anchor && s.head === s.anchor) emit('select', null)
  else select(s.anchor, i, 'touch')
}
function click(e: MouseEvent, i: number) {
  // A keyboard press (Enter, Space) has no pointer: comment the chosen block, or this line.
  if (!e.detail) { const p = sel.value?.via === 'keys' ? picked.value : null; return comment(p ? p[0] : i, p ? p[1] : i) }
  if (pointer !== 'mouse') tap(i)
}
// While a block is being chosen by touch, the whole row extends it, not only its number.
function rowTap(line: ReviewLine, i: number) {
  if (pointer === 'mouse' || sel.value?.via !== 'touch' || line.number === null || window.getSelection()?.toString()) return
  tap(i)
}

// Keyboard: one tab stop per diff, arrows move between its lines.
const stop = ref(-1)
const tabStop = computed(() => stop.value >= 0 && lines.value[stop.value]?.number != null ? stop.value : lines.value.findIndex(l => l.number !== null))
function focusRow(i: number) { root.value?.querySelector<HTMLElement>(`[data-row="${i}"] .review-gutter`)?.focus() }
function step(i: number, by: number, [lo, hi]: readonly [number, number]) {
  for (let j = i + by; j >= lo && j <= hi; j += by) if (lines.value[j]!.number !== null) return j
  return i
}
function key(e: KeyboardEvent, i: number) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const by = e.key === 'ArrowDown' ? 1 : -1
    if (e.shiftKey) {
      const anchor = sel.value?.via === 'keys' ? sel.value.anchor : i
      const to = step(i, by, hunkRange(lines.value, anchor))
      select(anchor, to, 'keys')
      focusRow(to)
    } else {
      if (sel.value) emit('select', null)
      focusRow(step(i, by, [0, lines.value.length - 1]))
    }
  } else if (e.key === 'Escape' && sel.value) {
    e.preventDefault()
    e.stopPropagation()
    emit('select', null)
  }
}

// Closing an editor gives the focus back to the line it was on.
function act(action: ReviewAction, id: string, text?: string) {
  const end = placed.value.find(p => p.c.id === id)?.at[1]
  emit('act', action, id, text)
  if (action === 'draft' || action === 'edit') return
  hovered.value = null
  if (end !== undefined && root.value?.contains(document.activeElement)) nextTick(() => focusRow(end))
}
function gutterLabel(line: ReviewLine) { return `${t('Comment on line')} ${line.number}${line.side === 'old' ? ` (${t('old line')})` : ''}` }
</script>
<template>
  <div ref="root" class="change-code" :class="{ picking: sel, dragging: sel?.via === 'drag' }" role="region" :aria-label="file.path" :aria-describedby="hint">
    <p :id="hint" class="sr-only">{{ t('Arrow keys move between lines. Shift+Arrow selects a block of lines. Enter writes a comment.') }}</p>
    <template v-for="(line, i) in lines" :key="i">
      <div
        class="change-line review-line" :data-row="i"
        :class="[line.kind, { picked: picked && i >= picked[0] && i <= picked[1], open: marks.open.has(i), noted: marks.noted.has(i), out: hunk && (i < hunk[0] - 1 || i > hunk[1]) }]"
        @pointerdown="seen" @click="rowTap(line, i)"
      >
        <button
          v-if="line.number !== null" type="button" class="review-gutter" :tabindex="i === tabStop ? 0 : -1" :aria-label="gutterLabel(line)"
          :aria-pressed="picked ? i >= picked[0] && i <= picked[1] : undefined"
          @pointerdown="down($event, i)" @click.stop="click($event, i)" @keydown="key($event, i)" @focus="stop = i"
        ><span class="review-plus" aria-hidden="true">+</span><span class="review-number">{{ line.number }}</span></button>
        <span class="review-source">{{ line.text }}</span>
      </div>
      <ReviewNote v-for="note in marks.notes.get(i)" :key="note.id" :comment="note" :label="label(note)" @act="act" @hover="hovered = $event" />
    </template>
  </div>
</template>
