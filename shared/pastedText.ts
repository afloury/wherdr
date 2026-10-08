// Long pasted text, shown as an attachment card ("Pasted text · N lines")
// instead of a huge bubble, like Claude Desktop.
//
// Where it comes from:
// - Claude Code wraps every paste in <pasted_content id="…">…</pasted_content id="…">
//   in its transcript, a multi-line send from wherdr included (the whole
//   message is one paste). The server lists the long blocks in ChatItem.pasted.
// - Codex and omp keep no trace of a paste: their transcript holds the plain
//   text. The blocks this device sent as pasted text (see app/utils/sentPastes.ts)
//   are found back in the message.
// Short blocks stay text: a three-line message typed in wherdr is a paste too.

export const PASTE_MIN_LINES = 12
export const PASTE_MIN_CHARS = 1500

export const lineCount = (s: string) => (s ? s.split('\n').length : 0)

// Long enough to become a card (in the message field and in the conversation).
export const isLongPaste = (s: string) => {
  const t = s.trim()
  return lineCount(t) > PASTE_MIN_LINES || t.length > PASTE_MIN_CHARS
}

const BLOCK = /<pasted_content(?:\s[^>]*)?>\n?([\s\S]*?)\n?<\/pasted_content(?:\s[^>]*)?>/g

// Contents of the long <pasted_content> blocks of a raw Claude message.
export function pastedBlocks(raw: string): string[] {
  if (!raw.includes('<pasted_content')) return []
  return [...raw.matchAll(BLOCK)].map(m => m[1]!.trim()).filter(isLongPaste)
}

// Message sent from the field: the typed text, its pasted texts as they are
// (a blank line between), then the attached files' paths, one per line.
// Every agent gets one plain message, the same as a paste into its terminal.
export function messageBody(text: string, pastes: string[], paths: string[]): string {
  return [[text.trim(), ...pastes].filter(Boolean).join('\n\n'), ...paths].filter(Boolean).join('\n')
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
// `listed`: blocks the transcript marked as pasted (ChatItem.pasted).
// `known`: blocks this device sent as pasted text; one found inside a listed
// block (a wherdr send: the typed words and the paste in one block) leaves the
// typed words in the text. Sent from another device, such a block is split
// the way wherdr builds it (messageBody): a short paragraph, a blank line,
// then the long text.
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
    const inner = longKnown.filter(k => k !== b && b.includes(k))
    if (inner.length) continue // left to the known blocks below
    const m = /^([^\n]+(?:\n[^\n]+){0,2})\n\n([\s\S]+)$/.exec(b)
    const block = m && m[1]!.length <= 400 && isLongPaste(m[2]!) ? m[2]!.trim() : b
    if (take(block)) pastes.push(block)
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
