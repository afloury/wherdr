// Replying to several questions of an agent in one message.
// Each question of a reply (a sentence ending with "?" in a paragraph or a
// list item, never in code) gets a small "↳ Reply" button right after it; a
// tap appends it to the draft as a quote, followed by an empty line for the
// answer:
//   > Can you plug the box in over Ethernet?
//   No, not for now.
//   > Shall I send the request to the coordinator?
//   Yes.
// The draft text is the only state: the quotes shown above the field, the
// "quoted" state of the buttons and their removal are all read from it.
// A point that asks nothing (a list item, a paragraph without a question) can
// be quoted the same way, to discuss it. How the two show is a setting
// (ReplyStyle): the markup below is the same for every style, main.css draws it.
import { truncateMiddle } from '../../shared/replyQuote'

// Longest quote kept (a selected passage can be long; the agent has the
// whole conversation, the start and the end are enough to find it).
export const QUOTE_MAX = 400

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
// What may close a question after its "?": quotes, brackets, emphasis, spaces.
const QUESTION_END = /\?[\s"'»”’)\]*_~]*$/
// A "?" closed by a quote mark belongs to quoted words (what the user asked,
// a label): 'You asked "can it be faster?"' is a statement.
const QUOTED_END = /\?\s*["'»”’][\s"'»”’)\]*_~]*$/
// Sentence boundary: end punctuation (and its closers) followed by a space,
// so that "v1.2" or "?x=1" never cuts a sentence; never before a French
// spaced "?", "!", ":" or ";" ("en Ethernet… ?"), nor before a lowercase
// letter ('"Why?" you asked', "e.g. this").
const SENTENCE_BREAK = /(?<=[.!?…]["'»”’)\]*_~]*)\s+(?=[^?!:;»\p{Ll}])/gu
// A statement that answers the question before it: the agent was not asking.
const SELF_ANSWER = /^[\s"'«“‘(*_~]*(?:yes|yep|no|nope|because|oui|non|si|parce\s+qu|car)(?![\p{L}\p{N}])/iu
const words = (s: string) => s.match(/[\p{L}\p{N}]+/gu)?.length || 0
const isQuestion = (s: string) => QUESTION_END.test(s) && !QUOTED_END.test(s) && words(s) > 0

// A question of a block of text: its words on one line, and where it sits in
// the block (`end` is right after its "?" and what closes it).
export interface Question { text: string, start: number, end: number }

// Questions asked by a block of text, in order. Consecutive question
// sentences are one question to answer ("Shall I push? Or wait?"); sentences
// that are not questions separate them, wherever they are in the block:
//   "Done. Shall I start step 1 now? A slot is free." → "Shall I start step 1 now?"
// A question the block answers itself ("Is it done? Yes.") or a one-word
// lead-in to a statement ("Why? Because…") is not one to reply to.
export function questionsIn(text: string): Question[] {
  if (!text.includes('?')) return []
  const sentences: { start: number, end: number, q: boolean }[] = []
  let from = 0
  const push = (to: number) => {
    const raw = text.slice(from, to)
    const start = from + raw.length - raw.trimStart().length
    const end = from + raw.trimEnd().length
    if (end > start) sentences.push({ start, end, q: isQuestion(text.slice(start, end)) })
  }
  for (const m of text.matchAll(SENTENCE_BREAK)) {
    push(m.index)
    from = m.index + m[0].length
  }
  push(text.length)
  const out: Question[] = []
  for (let i = 0; i < sentences.length; i++) {
    if (!sentences[i]!.q) continue
    let j = i
    while (j + 1 < sentences.length && sentences[j + 1]!.q) j++
    const start = sentences[i]!.start
    const end = sentences[j]!.end
    const next = sentences[j + 1]
    const q = oneLine(text.slice(start, end))
    const rhetorical = next && (SELF_ANSWER.test(text.slice(next.start, next.end)) || (i === j && words(q) < 2))
    if (!rhetorical) out.push({ text: q, start, end })
    i = j
  }
  return out
}

// Quote as sent: every line prefixed with "> ".
export function quoteOf(text: string): string {
  let lines = String(text || '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim())
  if (lines.join(' ').length > QUOTE_MAX) lines = [truncateMiddle(oneLine(lines.join(' ')), QUOTE_MAX)]
  return lines.map(l => `> ${l.trim()}`).join('\n')
}

// A quote line: ">" then a space (or nothing else), as quoteOf() writes it.
// ">>>", ">= 5" or ">file" are the user's own text, not quotes.
// Groups: 1 = prefix as typed, 2 = quoted text.
export const QUOTE_LINE = /^(>(?:\s|$))(.*)$/

export interface DraftQuote { text: string, start: number, end: number }

// Quotes of a draft: runs of consecutive "> " lines; `end` includes the
// newline that closes the run.
export function quotesIn(draft: string): DraftQuote[] {
  const out: DraftQuote[] = []
  let pos = 0
  let cur: DraftQuote | null = null
  for (const line of String(draft || '').split('\n')) {
    const end = pos + line.length
    const m = QUOTE_LINE.exec(line)
    if (m) {
      if (cur) {
        cur.text += `\n${m[2]}`
        cur.end = end
      } else cur = { text: m[2]!, start: pos, end }
    } else if (cur) {
      out.push(cur)
      cur = null
    }
    pos = end + 1
  }
  if (cur) out.push(cur)
  for (const q of out) if (q.end < draft.length) q.end++
  return out
}

export function isQuoted(draft: string, text: string): boolean {
  const want = oneLine(quoteOf(text).replace(/^> /gm, '')).toLowerCase()
  return Boolean(want) && quotesIn(draft).some(q => oneLine(q.text).toLowerCase() === want)
}

// Draft with the quote appended at the end (one quote/answer pair after the
// other, in order) and an empty line below it for the answer. A quote still
// unanswered is closed by an empty line, so the two never merge. Null if it
// is already quoted.
export function addQuote(draft: string, text: string): string | null {
  const quote = quoteOf(text)
  if (!quote || isQuoted(draft, text)) return null
  const base = String(draft || '').replace(/\s+$/, '')
  const sep = !base ? '' : QUOTE_LINE.test(base.slice(base.lastIndexOf('\n') + 1)) ? '\n\n' : '\n'
  return `${base}${sep}${quote}\n`
}

// Draft without one of its quotes (its answer stays).
export function removeQuote(draft: string, q: DraftQuote): string {
  return (draft.slice(0, q.start) + draft.slice(q.end)).replace(/^\n+/, '')
}

// Message display: quote lines apart from the rest.
export function quoteSegments(text: string): { quote: boolean, text: string }[] {
  const out: { quote: boolean, text: string }[] = []
  for (const line of String(text || '').split('\n')) {
    const m = QUOTE_LINE.exec(line)
    const quote = Boolean(m)
    const last = out.at(-1)
    const body = m ? m[2]! : line
    if (last && last.quote === quote) last.text += `\n${body}`
    else out.push({ quote, text: body })
  }
  return out
}

// Text of a block as the reader sees it, with the text node of each
// character: up to its first nested block (sub-list, code block), a line break
// counting as a space. `masked` is the same text with the sentence punctuation
// of inline code blanked out: "`a?.b`" or "`cmd?`" asks nothing.
const NESTED = /^(UL|OL|PRE|DIV|BLOCKQUOTE|TABLE)$/
function ownText(el: Element) {
  const parts: { node: Text, start: number }[] = []
  let raw = ''
  let masked = ''
  const walk = (parent: Node, code: boolean): boolean => {
    for (const n of parent.childNodes) {
      if (n.nodeType === 3) {
        const data = (n as Text).data
        parts.push({ node: n as Text, start: raw.length })
        raw += data
        masked += code ? data.replace(/[?!.…]/g, 'x') : data
      } else if (n.nodeType === 1) {
        const tag = (n as Element).tagName
        if (NESTED.test(tag)) return false
        if (tag === 'BR') {
          raw += '\n'
          masked += '\n'
        } else if (!walk(n, code || tag === 'CODE' || tag === 'KBD')) return false
      }
    }
    return true
  }
  walk(el, false)
  return { parts, raw, masked }
}

// How the reply targets show in a conversation (Settings › Conversation):
// `icon`, a small "↳" after each question and each point; `text`, the words of
// the question are the button and a point is clicked; `list`, a number after
// each question and the questions listed under the message.
export const REPLY_STYLES = ['icon', 'text', 'list'] as const
export type ReplyStyle = typeof REPLY_STYLES[number]
export const parseReplyStyle = (v: string | null | undefined): ReplyStyle =>
  (REPLY_STYLES as readonly string[]).includes(v || '') ? v as ReplyStyle : 'icon'

export interface ReplyLabels { reply: string, quoted: string, discuss: string }

// A point worth discussing: a few words that ask nothing and do not merely
// introduce what follows ("Three things to note:").
const POINT_MIN_WORDS = 3
export const isPoint = (text: string) => words(text) >= POINT_MIN_WORDS && !/[:：]$/.test(text.trim())

// Reply targets in the HTML of an agent reply. Each question gets a button
// right after it (`.q-reply`, numbered in reading order) and its words are
// wrapped (`.q-text`, same number); each point (`.q-pt`: a list item or a
// paragraph with no question) gets a button at its end (`.q-point`). The
// labels come from data attributes (CSS content): no text node, so the
// typewriter and the copied text ignore them.
export function markQuestions(root: ParentNode, labels: ReplyLabels) {
  const wrapped = new Map<HTMLElement, HTMLElement[]>()
  for (const el of root.querySelectorAll<HTMLElement>('p, li')) {
    if (el.closest('pre, code, .code-block, blockquote, table')) continue
    // A loose list item holds paragraphs: they carry the button.
    if (el.tagName === 'LI' && el.querySelector(':scope > p')) continue
    const { parts, raw, masked } = ownText(el)
    const last = raw.trimEnd().length
    const questions = questionsIn(masked)
    if (!questions.length && isPoint(raw)) {
      const point = oneLine(raw)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'q-point'
      btn.dataset.q = point
      btn.dataset.l = labels.discuss
      btn.dataset.lq = labels.quoted
      btn.setAttribute('aria-label', `${labels.discuss}: ${point}`)
      el.classList.add('q-pt')
      // At the end of the point's own text, before a nested list or code block.
      el.insertBefore(btn, [...el.children].find(c => NESTED.test(c.tagName)) || null)
    }
    // From the last one: a text node cut for a button keeps its start.
    for (const { start, end } of questions.reverse()) {
      const part = parts.findLast(p => p.start < end)
      if (!part) continue
      const q = oneLine(raw.slice(start, end))
      const btn = document.createElement('button')
      btn.type = 'button'
      // `q-mid`: more text follows in the block (see main.css).
      btn.className = end < last ? 'q-reply q-mid' : 'q-reply'
      btn.dataset.q = q
      btn.dataset.l = labels.reply
      btn.dataset.lq = labels.quoted
      btn.setAttribute('aria-label', `${labels.reply}: ${q}`)
      const cut = end - part.start
      if (cut < part.node.data.length) part.node.splitText(cut)
      // After the emphasis, link or code the question ends in, not inside it.
      let at: Node = part.node
      while (at.parentNode && at.parentNode !== el && (!at.nextSibling || /^(A|CODE|KBD)$/.test((at.parentNode as Element).tagName))) at = at.parentNode
      at.parentNode!.insertBefore(btn, at.nextSibling)
      // The words of the question, text node by text node (a question may
      // cross emphasis, a link or inline code); what is before it stays in
      // the node the earlier questions still point to.
      const spans: HTMLElement[] = []
      for (const p of parts.filter(x => x.start < end).reverse()) {
        const len = p.node.data.length
        if (p.start + len <= start) break
        const from = Math.max(0, start - p.start)
        const to = Math.min(len, end - p.start)
        if (to <= from) continue
        if (to < len) p.node.splitText(to)
        const node = from > 0 ? p.node.splitText(from) : p.node
        if (!node.data.trim()) continue
        const span = document.createElement('span')
        span.className = 'q-text'
        node.replaceWith(span)
        span.appendChild(node)
        spans.push(span)
      }
      wrapped.set(btn, spans)
    }
  }
  let n = 0
  for (const btn of root.querySelectorAll<HTMLElement>('.q-reply')) {
    btn.dataset.n = String(++n)
    for (const span of wrapped.get(btn) || []) span.dataset.n = btn.dataset.n
  }
}

const marked = new Map<string, string>()
// HTML of an agent reply with its question buttons (cached: the
// conversation is re-read every 1.5 s).
export function withQuestions(html: string, labels: ReplyLabels): string {
  if (typeof document === 'undefined') return html
  const key = `${labels.reply}\u0000${labels.discuss}\u0000${html}`
  let out = marked.get(key)
  if (out === undefined) {
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    markQuestions(tpl.content, labels)
    out = tpl.innerHTML
    marked.set(key, out)
    if (marked.size > 2000) marked.delete(marked.keys().next().value!)
  }
  return out
}

// What the "list" style shows under a reply: its questions in order, and
// whether it has points to quote. Read from the marked HTML, cached with it.
export interface ReplyTargets { questions: { n: string, text: string }[], points: number }
const targets = new Map<string, ReplyTargets>()
export function replyTargets(html: string): ReplyTargets {
  let out = targets.get(html)
  if (!out) {
    out = { questions: [], points: 0 }
    if (typeof document !== 'undefined' && html.includes('class="q-')) {
      const tpl = document.createElement('template')
      tpl.innerHTML = html
      out.questions = [...tpl.content.querySelectorAll<HTMLElement>('.q-reply')].map(b => ({ n: b.dataset.n || '', text: b.dataset.q || '' }))
      out.points = tpl.content.querySelectorAll('.q-point').length
    }
    targets.set(html, out)
    if (targets.size > 2000) targets.delete(targets.keys().next().value!)
  }
  return out
}
