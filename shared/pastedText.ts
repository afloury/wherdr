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

// Cuts `block` out of `text` (first occurrence). The text may be clipped by
// the server: a block found by its start is cut up to the end.
function cut(text: string, block: string): string | null {
  let at = text.indexOf(block)
  let len = block.length
  if (at < 0) {
    at = text.indexOf(block.slice(0, 200))
    if (at < 0 || at + len <= text.length) return null
    len = text.length - at
  }
  return (text.slice(0, at).replace(/\s+$/, '') + '\n' + text.slice(at + len).replace(/^\s+/, '')).trim()
}

// A user message split into its own words and its pasted texts.
// `listed`: blocks the server marked as pasted (ChatItem.pasted).
// `known`: blocks this device sent as pasted text; one found inside a listed
// block leaves the words around it in the text, and one a listed block is
// the start of (a queued record's text is cut short) is shown whole.
export function splitPasted(text: string, listed: string[] = [], known: string[] = []): { text: string, pastes: string[] } {
  let rest = text
  const pastes: string[] = []
  const take = (block: string) => {
    const r = cut(rest, block)
    if (r === null) return false
    rest = r
    return true
  }
  const longKnown = known.filter(isLongPaste)
  for (const b of listed) {
    if (longKnown.some(k => k !== b && (b.includes(k) || k.startsWith(b)))) continue // left to the known blocks below
    if (take(b)) pastes.push(b)
  }
  for (const k of longKnown) if (take(k)) pastes.push(k)
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
