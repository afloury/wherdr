import type { ChangeLine, ChangesResponse } from './types'

export interface ReviewLine extends ChangeLine { number: number | null, side: 'old' | 'new' }
export interface ReviewAnchor { number: number, side: 'old' | 'new', text: string }
// Line numbers of a block, per side of the diff: deleted lines count in the old file.
export interface ReviewSpan { new?: [number, number], old?: [number, number] }
export interface ReviewComment {
  id: string
  scope: 'working' | 'committed'
  path: string
  // First line of the block (its only line for a single-line comment).
  number: number
  side: 'old' | 'new'
  text: string
  // Last line of a block of several lines, always in the hunk of the first.
  end?: ReviewAnchor
  // Numbers and excerpt as they were when the block was chosen: all that is
  // left to show once the block is gone from the diff.
  span?: ReviewSpan
  excerpt?: string[]
  // Fingerprint of every line of the block: the same first and last lines
  // around other code are not the block that was commented.
  hash?: string
  body: string
  // Text being written; defined while the editor is open.
  draft?: string
}
// A block being chosen, before its comment exists: row indexes in the file's diff.
export interface ReviewSelection {
  scope: ReviewComment['scope']
  path: string
  anchor: number
  head: number
  via: 'drag' | 'touch' | 'keys'
  block: ReviewLine[]
}
export type ReviewAction = 'draft' | 'edit' | 'save' | 'cancel' | 'remove'

// Headers never receive a number. Deleted lines advance only the old file.
export function reviewLines(lines: ChangeLine[]): ReviewLine[] {
  let old: number | null = null
  let next: number | null = null
  return lines.map(line => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line.text)
    if (line.kind === 'hunk') { old = hunk ? Number(hunk[1]) : null; next = hunk ? Number(hunk[2]) : null }
    const side = line.kind === 'del' ? 'old' : 'new'
    const number = ['add', 'del', 'context'].includes(line.kind) ? (side === 'old' ? old : next) : null
    if (line.kind === 'del' || line.kind === 'context') { if (old !== null) old++ }
    if (line.kind === 'add' || line.kind === 'context') { if (next !== null) next++ }
    return { ...line, number, side }
  })
}

// First and last numbered rows of the hunk that holds row `i`: a block never
// leaves it, since the lines between two hunks are not in the diff.
export function hunkRange(lines: ReviewLine[], i: number): [number, number] {
  let a = i
  let b = i
  while (a > 0 && lines[a - 1]!.kind !== 'hunk') a--
  while (b < lines.length - 1 && lines[b + 1]!.kind !== 'hunk') b++
  while (a < i && lines[a]!.number === null) a++
  while (b > i && lines[b]!.number === null) b--
  return [a, b]
}

// Rows of the block from `anchor` to `head`, in order, kept inside the anchor's hunk.
export function clampBlock(lines: ReviewLine[], anchor: number, head: number): [number, number] {
  const [a, b] = hunkRange(lines, anchor)
  let to = Math.min(Math.max(head, a), b)
  while (to !== anchor && lines[to]!.number === null) to += to < anchor ? 1 : -1
  return anchor <= to ? [anchor, to] : [to, anchor]
}

const numbered = (block: ReviewLine[]) => block.filter((l): l is ReviewLine & { number: number } => l.number !== null)

export function reviewSpan(block: ReviewLine[]): ReviewSpan {
  const span: ReviewSpan = {}
  for (const l of numbered(block)) {
    const at = span[l.side]
    span[l.side] = at ? [Math.min(at[0], l.number), Math.max(at[1], l.number)] : [l.number, l.number]
  }
  return span
}

const EXCERPT_WIDTH = 100
// Up to three lines of the block, diff sign included; a longer block gives its
// first and last lines. Blank lines say nothing and are left out.
export function reviewExcerpt(block: ReviewLine[]): string[] {
  const rows = numbered(block).map(l => l.text.trimEnd()).filter(s => s.length > 1)
  const kept = rows.length > 3 ? [rows[0]!, '…', rows.at(-1)!] : rows
  return kept.map(s => s.length > EXCERPT_WIDTH ? `${s.slice(0, EXCERPT_WIDTH - 1)}…` : s)
}

// FNV-1a over the lines of the block, as text: short, stable across sessions.
export function reviewHash(block: ReviewLine[]): string {
  let h = 0x811c9dc5
  for (const c of numbered(block).map(l => l.text).join('\n')) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193)
  return (h >>> 0).toString(16)
}

// What a comment keeps of the block it was written on.
export function reviewBlock(block: ReviewLine[]): Pick<ReviewComment, 'number' | 'side' | 'text' | 'end' | 'span' | 'excerpt' | 'hash'> {
  const rows = numbered(block)
  const first = rows[0]!
  const last = rows.at(-1)!
  return {
    number: first.number, side: first.side, text: first.text,
    end: rows.length > 1 ? { number: last.number, side: last.side, text: last.text } : undefined,
    span: reviewSpan(rows), excerpt: reviewExcerpt(rows), hash: reviewHash(rows),
  }
}

const sameLine = (a: ReviewAnchor, b: { number: number | null, side: 'old' | 'new', text: string }) => a.number === b.number && a.side === b.side && a.text === b.text
export function sameBlock(a: Pick<ReviewComment, 'number' | 'side' | 'text' | 'end'>, b: Pick<ReviewComment, 'number' | 'side' | 'text' | 'end'>) {
  return sameLine(a, b) && Boolean(a.end) === Boolean(b.end) && (!a.end || sameLine(a.end, b.end!))
}

// Rows between the comment's first and last lines, both still there in one hunk.
function findEnds(comment: ReviewComment, lines: ReviewLine[]): [number, number] | null {
  for (let i = 0; i < lines.length; i++) {
    if (!sameLine(comment, lines[i]!)) continue
    if (!comment.end) return [i, i]
    for (let j = i + 1; j < lines.length && lines[j]!.kind !== 'hunk'; j++) {
      if (sameLine(comment.end, lines[j]!)) return [i, j]
    }
  }
  return null
}

// Rows of the comment's block in a file's diff: its first and last lines still
// there in one hunk, around the very lines that were commented.
export function locateReview(comment: ReviewComment, lines: ReviewLine[]): [number, number] | null {
  const at = findEnds(comment, lines)
  return at && (!comment.hash || comment.hash === reviewHash(lines.slice(at[0], at[1] + 1))) ? at : null
}

function fileLines(comment: ReviewComment, changes: ChangesResponse) {
  const file = changes[comment.scope]?.files.find(f => f.path === comment.path)
  return file ? reviewLines(file.lines) : null
}

export type ReviewStale = 'gone' | 'changed'
// Why a comment needs a look before it is sent: its block left the diff, or its
// ends are still there around code that changed. A hidden commit section is not
// a refreshed diff: its comments remain pending.
export function staleReview(comment: ReviewComment, changes: ChangesResponse, commitsRequested = false): ReviewStale | null {
  if (changes.git && comment.scope === 'committed' && !changes.committed && !commitsRequested) return null
  const lines = fileLines(comment, changes)
  if (lines && locateReview(comment, lines)) return null
  return lines && findEnds(comment, lines) ? 'changed' : 'gone'
}
export function missingReviews(comments: ReviewComment[], changes: ChangesResponse, commitsRequested = false): ReviewComment[] {
  return comments.filter(c => staleReview(c, changes, commitsRequested))
}

// Comments with the numbers and excerpt of their block as the diff shows it now.
// A block that changed or left the diff keeps what was read when it was commented.
export function freshReviews(comments: ReviewComment[], changes: ChangesResponse): ReviewComment[] {
  return comments.map(c => {
    const lines = fileLines(c, changes)
    const at = lines && locateReview(c, lines)
    return at ? { ...c, ...reviewBlock(lines.slice(at[0], at[1] + 1)), end: c.end } : c
  })
}

// The text that counts for a comment: what is being written, else what was saved.
export function reviewText(comment: ReviewComment) {
  return (comment.draft?.trim() ? comment.draft : comment.body).trim()
}

export function commentSpan(comment: ReviewComment): ReviewSpan {
  const one: [number, number] = [comment.number, comment.number]
  return comment.span ?? (comment.side === 'old' ? { old: one } : { new: one })
}

const range = (r: [number, number], dash: string) => r[0] === r[1] ? `${r[0]}` : `${r[0]}${dash}${r[1]}`
const many = (r: [number, number]) => r[0] !== r[1]

export interface SpanWords { line: string, lines: string, oldLine: string, oldLines: string }
// "Lines 12–18", "Line 7 (old line)", "Lines 10–11 + old lines 7–8".
export function spanLabel(span: ReviewSpan, w: SpanWords) {
  const old = span.old && (many(span.old) ? w.oldLines : w.oldLine)
  if (!span.new) return span.old ? `${many(span.old) ? w.lines : w.line} ${range(span.old, '–')} (${old})` : ''
  const label = `${many(span.new) ? w.lines : w.line} ${range(span.new, '–')}`
  return span.old ? `${label} + ${old} ${range(span.old, '–')}` : label
}

export interface ReviewWords { intro: string, oldLine: string, oldLines: string, missing: string, changed?: string }
// One remark per block: `file:12-18 — remark` (`file:12` for a single line),
// then the excerpt, indented. The agent edits the file as it goes, so line
// numbers drift from the second remark on, and deleted lines are in no file:
// the excerpt is what it can search for.
export function composeReview(comments: ReviewComment[], w: ReviewWords, stale: Record<string, ReviewStale | undefined> = {}) {
  const files = new Map<string, string[]>()
  for (const c of comments) {
    const body = reviewText(c).replace(/\s*\n\s*/g, ' ')
    if (!body) continue
    const span = commentSpan(c)
    const old = span.old && (many(span.old) ? w.oldLines : w.oldLine)
    const notes = [span.old ? (span.new ? `${old} ${range(span.old, '-')}` : old) : '', stale[c.id] === 'changed' ? w.changed ?? w.missing : stale[c.id] ? w.missing : ''].filter(Boolean)
    const head = `${c.path}:${range(span.new ?? span.old!, '-')}${notes.length ? ` (${notes.join(', ')})` : ''} — ${body}`
    const excerpt = (c.excerpt ?? [c.text.trimEnd()]).filter(Boolean).map(s => `    ${s}`)
    if (!files.has(c.path)) files.set(c.path, [])
    files.get(c.path)!.push([head, ...excerpt].join('\n'))
  }
  return files.size ? `${w.intro}\n\n${[...files.values()].map(lines => lines.join('\n')).join('\n\n')}` : ''
}
