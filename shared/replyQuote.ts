// Reply to a specific agent message: the message sent starts with a
// short marker (time + start of the message or chosen passage), never with the
// whole message: the agent already has the whole conversation in its context.
//   ↳ En réponse à ton message de 14:32 (« Je propose deux options : … »)
//   <empty line>
//   the reply
// On display, this marker becomes a small clickable quote box.

export interface ReplyTarget {
  time: string // displayed time of the original message ("14:32")
  excerpt: string // readable excerpt, already truncated
  part?: boolean // selected passage rather than the whole message
}

// Maximum length of the whole marker ("↳ …" line).
export const MARKER_MAX = 120

// Readable text of a markdown message: without code tags, links, headings,
// emphasis, and on a single line.
export function plainText(md: string): string {
  return String(md || '')
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|\*|_|`|~~)/g, '')
    .replace(/[«»“”"]/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

// Cuts at `max` characters at most, on a word end if possible, with "…".
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, Math.max(1, max - 1))
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`
}

// Keeps the start and the end, cut at words: "<start>… <end>" in `max`
// characters at most, so the agent knows exactly which passage is meant.
export function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s
  const room = max - 2 // "… "
  const startLen = Math.ceil(room / 2)
  const start = truncate(s, startLen + 1).replace(/…$/, '')
  let end = s.slice(s.length - (room - start.length))
  const space = end.indexOf(' ')
  if (space >= 0 && space < end.length * 0.4) end = end.slice(space + 1)
  return `${start}… ${end.replace(/^[\s,;:.]+/, '')}`
}

function head(lang: 'fr' | 'en', time: string) {
  return lang === 'en' ? `↳ Replying to your message from ${time} (` : `↳ En réponse à ton message de ${time} (`
}
const open = (lang: 'fr' | 'en') => (lang === 'en' ? '"' : '« ')
const close = (lang: 'fr' | 'en') => (lang === 'en' ? '")' : ' »)')

// Target of a reply: chosen passage (start and end if it is too long), otherwise start of the message,
// short enough for the whole marker to fit in MARKER_MAX.
export function replyTarget(message: string, time: string, lang: 'fr' | 'en', selection?: string): ReplyTarget {
  const room = MARKER_MAX - head(lang, time).length - open(lang).length - close(lang).length
  const part = Boolean(selection && selection.trim())
  const src = plainText(part ? selection! : message)
  return part ? { time, excerpt: truncateMiddle(src, Math.max(20, room)), part } : { time, excerpt: truncate(src, Math.max(20, room)) }
}

export function replyMarker(r: ReplyTarget, lang: 'fr' | 'en'): string {
  return `${head(lang, r.time)}${open(lang)}${r.excerpt}${close(lang)}`
}

// Message sent: marker + empty line + reply.
export function withReply(r: ReplyTarget | null | undefined, body: string, lang: 'fr' | 'en'): string {
  if (!r || !body) return body
  return `${replyMarker(r, lang)}\n\n${body}`
}

// Both languages are recognized (the app language may have changed since).
const MARKER_RE = /^↳ (?:En réponse à ton message de|Replying to your message from) (\d{1,2}[:h.]\d{2}(?:\s?[AaPp][Mm])?) \((?:« (.*) »|"(.*)")\)[ \t]*(?:\r?\n|$)/

// User message starting with a marker: quote + body.
export function parseReply(text: string): { reply: ReplyTarget, body: string } | null {
  const m = MARKER_RE.exec(String(text || ''))
  if (!m) return null
  const excerpt = m[2] ?? m[3] ?? ''
  return { reply: { time: m[1]!, excerpt }, body: text.slice(m[0].length).replace(/^\s*\n/, '').trim() }
}

const norm = (s: string) => plainText(s).toLowerCase()

// Original message of a quote, among the agent replies shown:
// same time and text containing the excerpt; failing that the excerpt alone, then
// the time alone. The most recent before the reply (index `before`) wins.
export function findReplyOrigin<T extends { time: string | null, text: string }>(list: T[], r: ReplyTarget, before = list.length): T | null {
  // Part before the first "…": start of the message, or of a "start… end" passage.
  const bit = norm(r.excerpt.split('…')[0]!).slice(0, 60)
  const cands = list.slice(0, before).reverse()
  const hasBit = (x: T) => Boolean(bit) && norm(x.text).includes(bit)
  return cands.find(x => x.time === r.time && hasBit(x))
    || cands.find(hasBit)
    || cands.find(x => x.time === r.time)
    || null
}

// Already normalized text (one line, lowercase) without its marker: two replies
// to the same message are not confused in the queue.
export function dropReplyMarker(normed: string): string {
  return normed.replace(/^↳ (?:en réponse à ton message de|replying to your message from) .*?(?: »|")\)\s*/i, '')
}
