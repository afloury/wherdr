// TEMPORARY (design proposals, t-0199): how to answer several questions or
// passages of an agent reply separately, in one message. "0" is the current
// behaviour (quotes written in the field, utils/questionReply.ts); "a" to "d"
// are the proposals, picked with `?replyux=a` in the address (remembered on the
// device). Removed once one is chosen.
//   a: cards stacked in the composer, one answer field per card
//   b: one field, quotes as compact non-editable tokens inside it
//   c: answer in place, under each question in the conversation, plus a drawer
//   d: "point by point" sheet: the reply split into points, one field each
//   e: "light b": the native field and text of "0", "> " lines drawn as tokens
//      by a mirror behind it (utils/quoteMirror.ts)
// Whatever the concept, the message sent is the same: each quote ("> " lines)
// above its answer, then the general word (see composeReplies).
import { reactive, ref } from 'vue'
import { quoteOf } from './questionReply'

export const REPLY_UXS = ['0', 'a', 'b', 'c', 'd', 'e'] as const
export type ReplyUx = typeof REPLY_UXS[number]

const valid = (v: unknown): v is ReplyUx => REPLY_UXS.includes(v as ReplyUx)

function initial(): ReplyUx {
  if (typeof window === 'undefined') return '0'
  try {
    const q = new URLSearchParams(location.search).get('replyux')
    if (valid(q)) {
      localStorage.setItem('replyUx', q)
      return q
    }
    const s = localStorage.getItem('replyUx')
    return valid(s) ? s : '0'
  } catch { return '0' }
}

export const replyUx = ref<ReplyUx>(initial())

// One reference (question or selected passage) and its answer.
export interface ReplyRef {
  id: string
  kind: 'question' | 'passage'
  text: string
  answer: string
  src: string | null // key of the agent message it comes from
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

// References of each conversation, in order (memory only for the proposals).
const store = reactive(new Map<string, ReplyRef[]>())
let seq = 0

export function replyRefs(paneId: string): ReplyRef[] {
  let list = store.get(paneId)
  if (!list) {
    store.set(paneId, [])
    list = store.get(paneId)!
  }
  return list
}

export const hasRef = (refs: readonly ReplyRef[], text: string) => refs.some(r => oneLine(r.text) === oneLine(text))

// Adds a reference at the end; the existing one if it is already there.
export function addRef(paneId: string, text: string, kind: ReplyRef['kind'], src: string | null = null): ReplyRef | null {
  const refs = replyRefs(paneId)
  if (!text.trim()) return null
  const found = refs.find(r => oneLine(r.text) === oneLine(text))
  if (found) return found
  refs.push({ id: `r${++seq}`, kind, text: text.trim(), answer: '', src })
  return refs.at(-1)!
}

export function removeRef(paneId: string, id: string) {
  const refs = replyRefs(paneId)
  const i = refs.findIndex(r => r.id === id)
  if (i >= 0) refs.splice(i, 1)
}

export function moveRef(paneId: string, id: string, by: -1 | 1) {
  const refs = replyRefs(paneId)
  const i = refs.findIndex(r => r.id === id)
  const j = i + by
  if (i < 0 || j < 0 || j >= refs.length) return
  const [r] = refs.splice(i, 1)
  refs.splice(j, 0, r!)
}

export function clearRefs(paneId: string) {
  replyRefs(paneId).splice(0)
}

// Message sent: each quote above its answer, pairs separated by an empty
// line, then the general word. The general word of a last reference left
// without an answer is its answer (one quote + the main field = the light case).
export function composeReplies(refs: readonly Pick<ReplyRef, 'text' | 'answer'>[], general: string): string {
  const parts = refs.map(r => [quoteOf(r.text), r.answer.trim()].filter(Boolean).join('\n')).filter(Boolean)
  const tail = general.trim()
  if (!parts.length) return tail
  if (!tail) return parts.join('\n\n')
  const last = refs.at(-1)!
  const sep = last.answer.trim() ? '\n\n' : '\n'
  return parts.join('\n\n') + sep + tail
}

// Points of an agent reply (concept d): its paragraphs and list items, in
// order, never in code, tables or quotes; `question` when the point asks one.
export interface ReplyPoint { text: string, question: boolean }
export function pointsOf(html: string, isQuestion: (text: string, inside: boolean) => string | null): ReplyPoint[] {
  if (typeof document === 'undefined') return []
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const out: ReplyPoint[] = []
  for (const el of tpl.content.querySelectorAll<HTMLElement>('p, li')) {
    if (el.closest('pre, code, .code-block, blockquote, table')) continue
    if (el.tagName === 'LI' && el.querySelector(':scope > p')) continue
    let own = ''
    for (const n of el.childNodes) {
      if (n.nodeType === 1 && /^(UL|OL|PRE|DIV|BUTTON)$/.test((n as Element).tagName)) break
      own += n.textContent || ''
    }
    const text = own.replace(/\s+/g, ' ').trim()
    if (text) out.push({ text, question: Boolean(isQuestion(text, Boolean(el.closest('li')))) })
  }
  return out
}

// Concept d: the point-by-point sheet (one at a time).
// `sub`: a passage selected inside a point, shown under it.
export interface SheetItem { id: string, text: string, question: boolean, answer: string, open: boolean, sub?: boolean }
export const sheet = ref<{ paneId: string, src: string | null, time: string, items: SheetItem[], general: string, focus: string | null } | null>(null)

export function openSheet(paneId: string, src: string | null, time: string, points: ReplyPoint[], focusText?: string) {
  const items: SheetItem[] = points.map((p, i) => ({ id: `p${i}`, text: p.text, question: p.question, answer: '', open: p.question }))
  // Passages already referenced from this conversation come along, right
  // under the point they were taken from.
  for (const r of replyRefs(paneId)) {
    const at = items.findIndex(it => oneLine(it.text).includes(oneLine(r.text)))
    const item = { id: r.id, text: r.text, question: r.kind === 'question', answer: r.answer, open: true }
    if (at >= 0 && oneLine(items[at]!.text) === oneLine(r.text)) Object.assign(items[at]!, { answer: items[at]!.answer || r.answer, open: true })
    else if (at >= 0) items.splice(at + 1, 0, { ...item, sub: true })
    else items.push(item)
  }
  const want = focusText ? oneLine(focusText) : ''
  const focus = want ? items.find(it => oneLine(it.text) === want) || items.find(it => oneLine(it.text).includes(want)) : null
  if (focus) focus.open = true
  sheet.value = { paneId, src, time, items, general: '', focus: focus ? focus.id : null }
}
