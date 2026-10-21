// One syntax for everything a message of the user refers to: an agent message,
// a point of it (a question, a list item, a selected passage), a row of a
// decision table, or a task (older messages). A reference is one whole
// line, the answer goes on the lines below it:
//   ↳ Quote message 11:37 : I can merge the PR —
//   Go ahead.
//   ↳ Quote decision 11:37 #3 : Publish the release notes on the site? —
//   No
// - It starts with "↳ " in the first column and ends with " —" at the end of
//   the line, and only there: an excerpt may hold dashes of its own.
// - `<type> <reference> : <excerpt>`: the types below, in English whatever the
//   language of the interface (the agent reads them, and one spelling is one
//   thing to recognize); the time shown on the message, then "#" and the
//   number of the row (or rows, "#1-4", "#1,4") for a decision table, then
//   "~" and a short code (messageId): what tells apart two messages of the same
//   minute, or two tables of one message. The app reads it, nobody else has to.
// - The excerpt is plain text on one line, cut with "…" when long: the time
//   and the number find the message, the excerpt says which part of it.
// - Task references keep their own labels, in both languages ("↳ Decision:
//   <task> —", "↳ Décision : <task> —"): herdr-projects 0.2's task actions
//   wrote them, and messages sent then still show them as references.
// Any other line is the user's own text, a "↳" typed by hand included.
import { OLD_MARKER_START, plainText, truncate, truncateMiddle } from './replyQuote'

export type RefKind = 'message' | 'point' | 'decision' | 'decisions' | 'task'
export interface Reference {
  kind: RefKind
  // Task action as written ("Decision:", "Retour sur"); '' for a quote.
  label: string
  time: string | null
  // Row of a decision table ("3"), or its rows ("1-4", "1,4").
  n: string | null
  // Which message, and which of its decision tables (messageId, tableId).
  // Null for a task, and for a line written without one.
  id: string | null
  excerpt: string
}

// Longest excerpt of a whole message or of a whole decision table (its
// start), and of a point, a passage or a row (its start and its end). Short:
// on a phone a reference should stay two or three lines of the field.
export const MESSAGE_MAX = 80
export const POINT_MAX = 120

const TIME = String.raw`\d{1,2}[:h.]\d{2}(?:\s?[AaPp][Mm])?`
// Characters of a message's code; a table after the first adds its rank ("k3f2").
const ID_CHARS = 3
// Groups: 1 = head up to the excerpt, 2 = kind, 3 = time, 4 = number, 5 = code, 6 = excerpt, 7 = tail.
const QUOTE_RE = new RegExp(`^(↳ Quote (message|point|decisions?)(?: (${TIME}))?(?: #(\\S+))?(?: ~([0-9a-z]{${ID_CHARS}}\\d*))? : )(\\S.*?)( —[ \\t]*)$`)
export const TASK_LABELS = ['Decision:', 'Décision :', 'Problem:', 'Problème :', 'Question:', 'Question :', 'Detail on', 'Précision sur', 'Feedback on', 'Retour sur'] as const
// Groups: 1 = head, 2 = label, 3 = task, 4 = tail.
const TASK_RE = new RegExp(`^(↳ (${TASK_LABELS.join('|')}) )(\\S.*?)( —[ \\t]*)$`)

const oneLine = (s: string) => String(s || '').replace(/\s+/g, ' ').trim()
const clean = (time: string | null | undefined) => oneLine(time || '') || null

// Code of an agent message: three characters from its time stamp and its
// first words, so the same on every device, whatever the excerpt shows and
// whatever the agent writes after them.
export function messageId(m: { ts: string | null, text: string }): string {
  const stamp = `${m.ts || ''}|${m.text.slice(0, 32)}`
  let h = 0x811c9dc5
  for (let i = 0; i < stamp.length; i++) h = Math.imul(h ^ stamp.charCodeAt(i), 0x01000193)
  return ((h >>> 0) % 36 ** ID_CHARS).toString(36).padStart(ID_CHARS, '0')
}
// Code of the decision table of rank `table` (from 1) in its message: the
// first one keeps the code of the message, a table added later changes nothing.
export const tableId = (id: string | null | undefined, table = 1) => (id && table > 1 ? `${id}${table}` : id || null)
// The message a code belongs to.
export const messageOf = (id: string) => id.slice(0, ID_CHARS)

// Whole agent message: the start of its readable text.
export function messageRef(markdown: string, time?: string | null, id?: string | null): Reference {
  return { kind: 'message', label: '', time: clean(time), n: null, id: id || null, excerpt: truncate(plainText(markdown), MESSAGE_MAX) || '…' }
}
// A question, a point or a selected passage, as the reader sees it.
export function pointRef(text: string, time?: string | null, id?: string | null): Reference {
  return { kind: 'point', label: '', time: clean(time), n: null, id: id || null, excerpt: truncateMiddle(oneLine(text), POINT_MAX) }
}
// Row `n` of a decision table, or the whole table (`n`: "1-4", `text`: its questions).
export function decisionRef(n: string, text: string, time?: string | null, all = false, id?: string | null): Reference {
  // The row numbers already say which rows: the first questions are enough.
  const excerpt = all ? truncate(oneLine(text), MESSAGE_MAX) : truncateMiddle(oneLine(text), POINT_MAX)
  return { kind: all ? 'decisions' : 'decision', label: '', time: clean(time), n: n.replace(/\s+/g, ''), id: id || null, excerpt }
}
export function taskRef(label: typeof TASK_LABELS[number], task: string): Reference {
  return { kind: 'task', label, time: null, n: null, id: null, excerpt: oneLine(task) }
}

// The line as sent. '' when there is nothing to quote.
export function refLine(r: Reference): string {
  if (!r.excerpt) return ''
  if (r.kind === 'task') return `↳ ${r.label} ${r.excerpt} —`
  return `↳ Quote ${r.kind}${r.time ? ` ${r.time}` : ''}${r.n ? ` #${r.n}` : ''}${r.id ? ` ~${r.id}` : ''} : ${r.excerpt} —`
}

// A line cut where a field draws it: what introduces the excerpt, the
// excerpt, and the closing dash.
export interface RefParts { ref: Reference, head: string, tail: string }
export function refParts(line: string): RefParts | null {
  const q = QUOTE_RE.exec(line)
  if (q) {
    const kind = q[2] as RefKind
    // A row number belongs to a decision, and a decision has one.
    if ((kind === 'decision' || kind === 'decisions') !== Boolean(q[4])) return null
    return { ref: { kind, label: '', time: clean(q[3]), n: q[4] ?? null, id: q[5] ?? null, excerpt: q[6]! }, head: q[1]!, tail: q[7]! }
  }
  const t = TASK_RE.exec(line)
  return t ? { ref: { kind: 'task', label: t[2]!, time: null, n: null, id: null, excerpt: t[3]! }, head: t[1]!, tail: t[4]! } : null
}
export const parseRef = (line: string): Reference | null => refParts(line)?.ref ?? null
export const isRefLine = (line: string) => refParts(line) !== null

// The same thing referred to. The codes say whether it is the same message
// and table; a reference written without one is told by its time, and one
// written without a time (a message that has none) matches any.
const norm = (s: string | null) => oneLine(s || '').toLowerCase()
export function sameRef(a: Reference, b: Reference): boolean {
  return a.kind === b.kind && norm(a.label) === norm(b.label) && norm(a.n) === norm(b.n) && norm(a.excerpt) === norm(b.excerpt)
    && (a.id && b.id ? a.id === b.id : !a.time || !b.time || a.time === b.time)
}

// References of a text, with their place: `end` includes the line break.
export interface TextRef extends Reference { start: number, end: number }
export function refsIn(text: string): TextRef[] {
  const out: TextRef[] = []
  let pos = 0
  const all = String(text || '')
  for (const line of all.split('\n')) {
    const ref = line.startsWith('↳') ? parseRef(line) : null
    if (ref) out.push({ ...ref, start: pos, end: Math.min(all.length, pos + line.length + 1) })
    pos += line.length + 1
  }
  return out
}

// Text that came from elsewhere (pasted, dropped): a line of it that reads as
// a reference gets a "\" before its "↳", so it stays the plain text it is.
// Only what wherdr's own buttons write is a reference. A character that
// shows, not a space: sending and the agents' transcripts trim a message.
export function unreference(text: string): string {
  if (!text.includes('↳')) return text
  return text.split('\n').map(l => (l.startsWith('↳') && isRefLine(l.replace(/\r$/, '')) ? `\\${l}` : l)).join('\n')
}

// Two texts already normalized (one line, lowercase) that are one message:
// the reference each starts with is the same one, and `sameWords` holds for
// what follows it. Without this, "Yes" under one reference would pass for
// "Yes" under another, and two answers to one message for each other (a
// comparison only looks at the first characters). A text cut short (a line
// of the agent's screen) may have lost the end of its reference: it is then
// compared as it is.
const LEAD_RE = new RegExp(`^↳ (?:quote (?:message|point|decisions?)|${TASK_LABELS.join('|').toLowerCase()}) .*? —(?:\\s+|$)`)
function lead(normed: string): { ref: string, words: string } {
  const m = LEAD_RE.exec(normed) || OLD_MARKER_START.exec(normed)
  return m ? { ref: m[0].replace(/\s+/g, ''), words: normed.slice(m[0].length) } : { ref: '', words: normed }
}
export function sameSent(a: string, b: string, sameWords: (a: string, b: string) => boolean): boolean {
  const x = lead(a)
  const y = lead(b)
  if (!x.ref || !y.ref) return sameWords(a, b)
  return x.ref === y.ref && (x.words || y.words ? sameWords(x.words, y.words) : true)
}

// Message display: its references apart from the words under them. A run of
// "> " lines is a quote too: that is how quotes were written before.
export const OLD_QUOTE_LINE = /^>(?:\s|$)(.*)$/
export type Segment = { kind: 'ref', ref: Reference } | { kind: 'quote', text: string } | { kind: 'text', text: string }
export function refSegments(text: string): Segment[] {
  const out: Segment[] = []
  for (const line of String(text || '').split('\n')) {
    const ref = line.startsWith('↳') ? parseRef(line) : null
    if (ref) { out.push({ kind: 'ref', ref }); continue }
    const old = OLD_QUOTE_LINE.exec(line)
    const kind = old ? 'quote' : 'text'
    const body = old ? old[1]! : line
    const last = out.at(-1)
    if (last && last.kind === kind) last.text += `\n${body}`
    else out.push({ kind, text: body })
  }
  return out
}
