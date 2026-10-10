// Long pasted text, shown as an attachment card ("Pasted text · N lines")
// instead of a huge bubble, like Claude Desktop.
//
// Where it comes from:
// - Claude Code wraps every paste in <pasted_content id="…">…</pasted_content id="…">
//   in its transcript, a multi-line send from wherdr included (the whole
//   message is one block, typed words and all). Such a block proves nothing:
//   the server lists in ChatItem.pasted only the long blocks that sit next to
//   words typed outside them (a paste into the agent's terminal).
// - Codex and omp keep no trace of a paste: their transcript holds the plain
//   text.
// - The blocks sent as pasted text from wherdr's field are found back in the
//   message, whatever the agent: the app tells the server where they sit
//   (pasteRanges), and the server lists them for every device (see
//   server/utils/pastes.ts). The device that sent them remembers them too
//   (app/utils/sentPastes.ts).
// A message written in wherdr's field is never a card, however long.

export const PASTE_MIN_LINES = 12
export const PASTE_MIN_CHARS = 1500

export const lineCount = (s: string) => (s ? s.split('\n').length : 0)

// Long enough to become a card (in the message field and in the conversation).
export const isLongPaste = (s: string) => {
  const t = s.trim()
  return lineCount(t) > PASTE_MIN_LINES || t.length > PASTE_MIN_CHARS
}

const BLOCK = /<pasted_content(?:\s[^>]*)?>\n?([\s\S]*?)\n?<\/pasted_content(?:\s[^>]*)?>/g

// Contents of the long <pasted_content> blocks of a raw Claude message (one
// text part). None when the blocks are the whole message: that is how a
// multi-line message sent from wherdr arrives, and it was typed.
export function pastedBlocks(raw: string): string[] {
  if (!raw.includes('<pasted_content')) return []
  if (!raw.replace(BLOCK, '').replace(/\[Image #\d+[^\]]*\]/g, '').trim()) return []
  return [...raw.matchAll(BLOCK)].map(m => m[1]!.trim()).filter(isLongPaste)
}

// Message sent from the field: the typed text, its pasted texts as they are
// (a blank line between), then the attached files' paths, one per line.
// Every agent gets one plain message, the same as a paste into its terminal.
export function messageBody(text: string, pastes: string[], paths: string[]): string {
  return [[text.trim(), ...pastes].filter(Boolean).join('\n\n'), ...paths].filter(Boolean).join('\n')
}

// Where `blocks` (pasted texts) sit in the message `body`, as [start, length]:
// what the app sends along with a message, instead of the blocks again.
export function pasteRanges(body: string, blocks: string[]): [number, number][] {
  const out: [number, number][] = []
  for (const b of blocks) {
    const at = b ? body.indexOf(b) : -1
    if (at >= 0) out.push([at, b.length])
  }
  return out
}

// A queued record only keeps the start of its text (server/utils/state.ts addQueued).
export const QUEUED_CHARS = 4000

// A text the server cut short: a conversation message then ends with "…", a
// queued record stops at QUEUED_CHARS.
const cutShort = (text: string) => text.endsWith('…') || text.length === QUEUED_CHARS

// Cuts `block` out of `text` (first occurrence): the text left, and the part
// of the block the text holds. A text cut short may stop inside the block:
// the part is then what the text holds of it, up to its end (`short`: the
// part ends a text cut short, more of it may be missing). A whole text only
// holds a whole block: one that merely starts like another is not it.
// `open`: the text is cut short, and its end is not taken yet.
function cut(text: string, block: string, open: boolean): { rest: string, part: string, short: boolean } | null {
  const body = open ? text.replace(/…$/, '') : null
  let at = text.indexOf(block)
  let end = at + block.length
  let part = block
  if (at < 0) {
    if (body === null) return null
    at = body.indexOf(block.slice(0, 200))
    if (at < 0 || !block.startsWith(body.slice(at))) return null
    part = body.slice(at).trimEnd()
    if (!isLongPaste(part)) return null
    end = text.length
  }
  // The part ends a text cut short: its "…" goes with it.
  const short = body !== null && end >= body.trimEnd().length
  if (short) end = text.length
  return { rest: (text.slice(0, at).replace(/\s+$/, '') + '\n' + text.slice(end).replace(/^\s+/, '')).trim(), part, short }
}

// A user message split into its own words and its pasted texts. A card only
// ever holds text of the message itself: of a text cut short, what it holds.
// `listed`: blocks the server marked as pasted (ChatItem.pasted).
// `known`: blocks this device sent as pasted text; one found inside a listed
// block leaves the words around it in the text.
// `whole`: for a text cut short, the block this device sent instead of the
// part left of it, when only one starts that way (a cancelled message put
// back into the field).
export function splitPasted(text: string, listed: string[] = [], known: string[] = [], whole = false): { text: string, pastes: string[] } {
  let rest = text
  const pastes: string[] = []
  // The longest first: one of them may sit inside another.
  const longKnown = known.filter(isLongPaste).sort((a, b) => b.length - a.length)
  let open = cutShort(text)
  const take = (block: string) => {
    const r = cut(rest, block, open)
    if (r === null) return
    rest = r.rest
    if (r.short) open = false
    const sent = whole && r.short ? longKnown.filter(k => k.startsWith(r.part)) : []
    pastes.push(sent.length === 1 ? sent[0]! : r.part)
  }
  for (const b of listed) {
    if (longKnown.some(k => k !== b && b.includes(k))) continue // left to the known blocks below
    take(b)
  }
  for (const k of longKnown) take(k)
  if (!pastes.length) return { text, pastes }
  // Back in the order the user wrote them.
  pastes.sort((a, b) => text.indexOf(a.slice(0, 200)) - text.indexOf(b.slice(0, 200)))
  return { text: rest, pastes }
}

// Log, code or terminal output (monospace), rather than prose.
export function looksLikeLog(s: string): boolean {
  const lines = s.split('\n').filter(l => l.trim())
  if (!lines.length) return false
  const techy = lines.filter(l => /^\s{2,}|^\s*[>$#=*|+[\]{}()<-]|\t|==>|\d{1,2}:\d{2}|[\\/][\w.-]+[\\/]|[;{}]\s*$|\w+\(.*\)|\b(?:ERROR|WARN|INFO|DEBUG)\b/.test(l)).length
  return techy / lines.length >= 0.3
}
