// The little TOML herdr-projects writes in its files (an inbox item's front
// matter, PROJECT.md's): keys with string values in their four forms ("…",
// '…' and the multi-line ones), bare values (numbers, booleans) and table
// headers. Pure functions, tested in tests/projectInbox.test.ts and
// tests/projectDocs.test.ts. Every pattern is applied to one line at a time:
// none can walk a run of blank lines again and again.
const ESCAPES: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1B', '"': '"', '\\': '\\' }
function unescapeBasic(s: string): string {
  return s
    // Multi-line strings: a backslash at the end of a line joins the next one.
    .replace(/\\[ \t]*\n\s*/g, '')
    .replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[\s\S])/g, (all, x: string) => {
      if (x.length > 1) {
        const code = Number.parseInt(x.slice(1), 16)
        return code <= 0x10FFFF ? String.fromCodePoint(code) : all
      }
      return ESCAPES[x] ?? all
    })
}

// End of a quoted TOML string starting at `from`: index of the closing
// delimiter, skipping escaped quotes in basic strings. -1: not closed.
function closing(text: string, from: number, quote: string, basic: boolean): number {
  for (let i = from; i < text.length; i++) {
    if (basic && text[i] === '\\') { i++; continue }
    if (quote.length === 1 && text[i] === '\n') return -1
    if (text.startsWith(quote, i)) {
      // `""""`: up to two quotes may sit right before a multi-line delimiter.
      if (quote.length === 3) while (text[i + 3] === quote[0]) i++
      return i
    }
  }
  return -1
}

// One table of a TOML text: the keys before the first header (name ''), then
// one entry per `[name]` or `[[name]]` header, in order.
export interface TomlTable { name: string, strings: Record<string, string>, bare: Record<string, string> }

const HEADER = /^[ \t]*\[\[?[ \t]*([A-Za-z0-9_.-]+)[ \t]*\]\]?[ \t]*(?:#.*)?$/
const KEY = /^[ \t]*([A-Za-z0-9_-]+)[ \t]*=[ \t]*/

// A header or a key is only read at the start of a line outside a string: a
// line of a multi-line string that looks like `[x]` or `key = 1` is text.
export function tomlTables(input: string): TomlTable[] {
  const text = String(input || '').replace(/\r\n?/g, '\n')
  let table: TomlTable = { name: '', strings: {}, bare: {} }
  const tables = [table]
  let at = 0
  while (at < text.length) {
    const eol = text.indexOf('\n', at)
    const line = text.slice(at, eol < 0 ? text.length : eol)
    let next = eol < 0 ? text.length : eol + 1
    const header = HEADER.exec(line)
    const m = header ? null : KEY.exec(line)
    if (header) {
      table = { name: header[1]!, strings: {}, bare: {} }
      tables.push(table)
    } else if (m) {
      const start = at + m[0].length
      const quote = ['"""', '\'\'\'', '"', '\''].find(q => text.startsWith(q, start))
      if (quote) {
        const basic = quote[0] === '"'
        const end = closing(text, start + quote.length, quote, basic)
        if (end >= 0) {
          let raw = text.slice(start + quote.length, end)
          // A newline right after a multi-line opening is not part of the value.
          if (quote.length === 3 && raw.startsWith('\n')) raw = raw.slice(1)
          table.strings[m[1]!] = basic ? unescapeBasic(raw) : raw
          const after = text.indexOf('\n', end + quote.length)
          next = after < 0 ? text.length : after + 1
        }
      } else {
        const value = line.slice(m[0].length).split('#')[0]!.trim()
        if (value) table.bare[m[1]!] = value
      }
    }
    at = next
  }
  return tables
}

// String values of a TOML text, whatever their table (a later one wins): all
// an inbox item holds.
export function tomlStrings(front: string): Record<string, string> {
  return Object.assign({}, ...tomlTables(front).map(t => t.strings)) as Record<string, string>
}
