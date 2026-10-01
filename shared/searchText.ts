// Global search text, shared by the server (excerpts) and the app
// (highlighting): accent folding, position of a match, markdown removed
// and excerpt cut on word boundaries.

export const foldSearch = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase()

// Start and end (positions in `text`) of the first match of `query`,
// ignoring accents and case, even when a character decomposes in NFD.
export function matchRange(text: string, query: string): [number, number] | null {
  const needle = foldSearch(query)
  if (!needle) return null
  let folded = ''
  const starts: number[] = []
  const ends: number[] = []
  for (let i = 0; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i)!)
    const part = foldSearch(char)
    folded += part
    for (let j = 0; j < part.length; j++) { starts.push(i); ends.push(i + char.length) }
    i += char.length
  }
  const at = folded.indexOf(needle)
  return at < 0 ? null : [starts[at]!, ends[at + needle.length - 1]!]
}

export function matchAt(text: string, query: string): number {
  const range = matchRange(text, query)
  return range ? range[0] : -1
}

// Markdown -> readable one-line text: bold (**), italics, code, links,
// headings, lists, quotes and tables removed, spaces collapsed. The bold
// "__x__" is left alone: it would damage __init__.py, far more common here.
export function stripMarkdown(md: string): string {
  return md
    .replace(/^[ \t]*(`{3,}|~{3,}).*$/gm, '')
    .replace(/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) => row.split('|').map(c => c.trim()).filter(Boolean).join(' · '))
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(>[ \t]?)+/gm, '')
    .replace(/^[ \t]*(?:[-*+•]|\d{1,3}[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\((?:[^()\n]|\([^)\n]*\))*\)/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
    .replace(/`+([^`\n]*?)`+/g, '$1')
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '$1')
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, '$1')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
    // Leftovers of a cut piece of markdown ("**Displ", lone backtick).
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Excerpt of about `width` characters around the match, without markdown,
// cut between two words ("…" at cut ends). A word longer than
// `slack` characters is cut sharply rather than shifting the excerpt too much.
export function excerpt(text: string, at: number, width = 120, query = '', slack = 24) {
  // Wide window around the match, cleaned, then the match found again
  // in the cleaned text (markdown shifts the positions).
  const from = Math.max(0, at - width * 2)
  const to = Math.min(text.length, at + width * 3)
  const clean = stripMarkdown(text.slice(from, to))
  const cutHead = from > 0
  const cutTail = to < text.length
  let pos = query ? matchAt(clean, query) : -1
  if (pos < 0) {
    // Match in a removed part (link address…): same proportion.
    const ratio = to > from ? (at - from) / (to - from) : 0
    pos = Math.round(clean.length * ratio)
  }
  const len = query ? (matchRange(clean, query)?.[1] ?? pos) - pos : 0
  let start = Math.max(0, pos - Math.floor(width / 3))
  let end = Math.min(clean.length, Math.max(start + width, pos + len))
  if (end - start > width && end === clean.length) start = Math.max(0, Math.min(start, end - width))
  if (start > 0 || cutHead) {
    // Back to the start of the word, or forward to the next word if it is too far.
    const back = clean.lastIndexOf(' ', start)
    if (back >= 0 && start - back <= slack) start = back + 1
    else {
      const fwd = clean.indexOf(' ', start)
      if (fwd >= 0 && fwd - start <= slack && fwd < pos) start = fwd + 1
    }
  }
  if (end < clean.length || cutTail) {
    const back = clean.lastIndexOf(' ', end)
    if (back > Math.max(start, pos + len) && end - back <= slack) end = back
    else {
      const fwd = clean.indexOf(' ', end)
      if (fwd >= 0 && fwd - end <= slack) end = fwd
    }
  }
  const body = clean.slice(start, end).replace(/[\s,;:·–—-]+$/, '').replace(/^[\s,;:·–—-]+/, '')
  // Finished sentence: no ellipsis stuck to the period.
  const more = (end < clean.length || cutTail) && !/[.!?…]$/.test(body)
  return `${start > 0 || cutHead ? '…' : ''}${body}${more ? '…' : ''}`
}

// Pieces of an excerpt for display, with the match marked.
export function highlightParts(text: string, query: string): { text: string, hit: boolean }[] {
  const range = query.trim() ? matchRange(text, query.trim()) : null
  if (!range) return [{ text, hit: false }]
  return [
    { text: text.slice(0, range[0]), hit: false },
    { text: text.slice(range[0], range[1]), hit: true },
    { text: text.slice(range[1]), hit: false },
  ].filter(p => p.text)
}
