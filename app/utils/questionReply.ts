// Replying to several questions of an agent in one message.
// Each question of a reply (list item or paragraph ending with "?", never in
// code) gets a small "↳ Reply" button; a tap appends it to the draft as a
// quote, followed by an empty line for the answer:
//   > Can you plug the box in over Ethernet?
//   No, not for now.
//   > Shall I send the request to the coordinator?
//   Yes.
// The draft text is the only state: the quotes shown above the field, the
// "quoted" state of the buttons and their removal are all read from it.
import { truncateMiddle } from '../../shared/replyQuote'

// Longest quote kept (a selected passage can be long; the agent has the
// whole conversation, the start and the end are enough to find it).
export const QUOTE_MAX = 400

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
// What may close a question after its "?": quotes, brackets, emphasis, spaces.
const QUESTION_END = /\?[\s"'»”’)\]*_~]*$/
// Sentence boundary: end punctuation (and its closers) followed by a space,
// so that "v1.2" never cuts a question; never before a French spaced "?",
// "!", ":" or ";" ("en Ethernet… ?").
const SENTENCE_BREAK = /(?<=[.!?…]["'»”’)\]*_~]*)\s+(?=[^?!:;»])/

// Question asked by a block of text, or null: the trailing sentences that are
// questions ("Done. Shall I push? Or wait?" → "Shall I push? Or wait?").
// A list item is one point to answer: its last questions count even when an
// explanation follows them (`inside`: "Plug it in? Wi-Fi is slow." → "Plug it in?").
export function questionIn(text: string, inside = false): string | null {
  const s = oneLine(text)
  if (s.length < 3 || !s.includes('?')) return null
  const sentences = s.split(SENTENCE_BREAK)
  let end = sentences.length
  if (inside) while (end > 0 && !QUESTION_END.test(sentences[end - 1]!)) end--
  let start = end
  while (start > 0 && QUESTION_END.test(sentences[start - 1]!)) start--
  return start < end ? sentences.slice(start, end).join(' ') : null
}

// Quote as sent: every line prefixed with "> ".
export function quoteOf(text: string): string {
  let lines = String(text || '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim())
  if (lines.join(' ').length > QUOTE_MAX) lines = [truncateMiddle(oneLine(lines.join(' ')), QUOTE_MAX)]
  return lines.map(l => `> ${l.trim()}`).join('\n')
}

export interface DraftQuote { text: string, start: number, end: number }

// Quotes of a draft: runs of consecutive "> " lines; `end` includes the
// newline that closes the run.
export function quotesIn(draft: string): DraftQuote[] {
  const out: DraftQuote[] = []
  let pos = 0
  let cur: DraftQuote | null = null
  for (const line of String(draft || '').split('\n')) {
    const end = pos + line.length
    const m = /^>\s?(.*)$/.exec(line)
    if (m) {
      if (cur) {
        cur.text += `\n${m[1]}`
        cur.end = end
      } else cur = { text: m[1]!, start: pos, end }
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
  const sep = !base ? '' : /(^|\n)>[^\n]*$/.test(base) ? '\n\n' : '\n'
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
    const m = /^>\s?(.*)$/.exec(line)
    const quote = Boolean(m)
    const last = out.at(-1)
    const body = m ? m[1]! : line
    if (last && last.quote === quote) last.text += `\n${body}`
    else out.push({ quote, text: body })
  }
  return out
}

// Question buttons in the HTML of an agent reply. The label comes from data
// attributes (CSS content): no text node, so the typewriter and the copied
// text ignore it.
export function markQuestions(root: ParentNode, labels: { reply: string, quoted: string }) {
  for (const el of root.querySelectorAll<HTMLElement>('p, li')) {
    if (el.closest('pre, code, .code-block, blockquote, table')) continue
    // A loose list item holds paragraphs: they carry the button.
    if (el.tagName === 'LI' && el.querySelector(':scope > p')) continue
    let own = ''
    for (const n of el.childNodes) {
      if (n.nodeType === 1 && /^(UL|OL|PRE|DIV)$/.test((n as Element).tagName)) break
      own += n.textContent || ''
    }
    const q = questionIn(own, Boolean(el.closest('li')))
    if (!q) continue
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'q-reply'
    btn.dataset.q = q
    btn.dataset.l = labels.reply
    btn.dataset.lq = labels.quoted
    btn.setAttribute('aria-label', `${labels.reply}: ${q}`)
    const nested = [...el.children].find(c => /^(UL|OL|PRE|DIV)$/.test(c.tagName))
    el.insertBefore(btn, nested || null)
  }
}

const marked = new Map<string, string>()
// HTML of an agent reply with its question buttons (cached: the
// conversation is re-read every 1.5 s).
export function withQuestions(html: string, labels: { reply: string, quoted: string }): string {
  if (typeof document === 'undefined') return html
  const key = `${labels.reply}\u0000${html}`
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
