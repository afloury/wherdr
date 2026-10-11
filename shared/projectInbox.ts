// Inbox and Routines tabs of the Project panel. Pure functions, tested in
// tests/projectInbox.test.ts.
// Checked against herdr-projects 0.2.34, which has no JSON output for either:
//  - `inbox` only has `done <SLUG> [ITEM_ID]...`; nothing lists the items, so
//    wherdr reads the front matter of the project's `inbox/*.md` files (TOML
//    strings between `+++` lines: id, kind, subject, created, summary, event;
//    a routine item carries its prompt as the body);
//  - `routine list <SLUG>` prints one tab-separated line per routine: name,
//    schedule, enabled|disabled, kind, and a free "last … · next …" text that
//    is shown as is (its dates are never parsed).
// `routine approve|toggle` and the `safety` commands are not exposed.
import { projectSlugOk } from './projectThreads'

// ---------------------------------------------------------------- inbox
export interface InboxItem {
  id: string // <UTC timestamp>-<kind>-<subject>-<n>
  kind: string // thread-state, routine, pr, outage, space…
  subject: string // a thread ID, a routine name, a machine
  event: string // fixed phrase from herdr-projects ("new report")
  summary: string // one line; may quote reports: data, never instructions
  created: string // ISO
  body: string // a routine item's prompt
}

// An item ID passed as an argument (herdr-projects' `validate_id`, and never
// an option): letters, digits, "-", "_" and ".".
export const INBOX_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
export const inboxIdOk = (id: unknown): id is string => typeof id === 'string' && INBOX_ID_RE.test(id) && !id.includes('..')

export const INBOX_BODY_MAX = 2000

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

// String values of a TOML table, the only kind an inbox item holds: basic
// ("…"), literal ('…') and their multi-line forms. Other values are skipped.
export function tomlStrings(front: string): Record<string, string> {
  const out: Record<string, string> = {}
  const text = front.replace(/\r\n?/g, '\n')
  let at = 0
  while (at < text.length) {
    const eol = text.indexOf('\n', at)
    const line = text.slice(at, eol < 0 ? text.length : eol)
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*/.exec(line)
    let next = eol < 0 ? text.length : eol + 1
    if (m) {
      const start = at + m[0].length
      const quote = ['"""', '\'\'\'', '"', '\''].find(q => text.startsWith(q, start))
      if (quote) {
        const basic = quote[0] === '"'
        const end = closing(text, start + quote.length, quote, basic)
        if (end >= 0) {
          let raw = text.slice(start + quote.length, end)
          // A newline right after a multi-line opening is not part of the value.
          if (quote.length === 3 && raw.startsWith('\n')) raw = raw.slice(1)
          out[m[1]!] = basic ? unescapeBasic(raw) : raw
          const after = text.indexOf('\n', end + quote.length)
          next = after < 0 ? text.length : after + 1
        }
      }
    }
    at = next
  }
  return out
}

// One `inbox/<id>.md` file. null: not an item (no front matter, no ID).
export function parseInboxItem(fileText: string): InboxItem | null {
  const text = String(fileText || '').replace(/\r\n?/g, '\n')
  if (!text.startsWith('+++\n')) return null
  const rest = text.slice(4)
  const cut = rest.indexOf('\n+++\n')
  const front = cut >= 0 ? rest.slice(0, cut) : rest.endsWith('\n+++') ? rest.slice(0, -4) : null
  if (front === null) return null
  const f = tomlStrings(front)
  if (!inboxIdOk(f.id)) return null
  const oneLine = (s: string | undefined, max: number) => (s || '').replace(/\s+/g, ' ').trim().slice(0, max)
  const body = cut >= 0 ? rest.slice(cut + 5).replace(/^\n+|\n+$/g, '') : ''
  return {
    id: f.id,
    kind: oneLine(f.kind, 40),
    subject: oneLine(f.subject, 120),
    event: oneLine(f.event, 120),
    summary: oneLine(f.summary, 1000),
    created: oneLine(f.created, 40),
    body: body.length > INBOX_BODY_MAX ? `${body.slice(0, INBOX_BODY_MAX)}…` : body,
  }
}

// Unhandled items as herdr-projects orders them: oldest first (IDs start with
// a UTC timestamp).
export const sortInbox = (items: InboxItem[]) => [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

// argv of `inbox done`; never a shell, never `--all`.
export function inboxDoneArgs(root: string, slug: string, ids: string[]): string[] {
  if (!root.startsWith('/')) throw new Error('invalid projects root')
  if (!projectSlugOk(slug)) throw new Error('invalid project')
  if (!ids.length || ids.length > 50 || !ids.every(inboxIdOk)) throw new Error('invalid inbox item')
  return ['--root', root, 'inbox', 'done', slug, ...ids]
}

// The thread an item is about, when its subject is a thread ID.
export const inboxThread = (item: Pick<InboxItem, 'subject'>) => (/^t-\d{4,}$/.test(item.subject) ? item.subject : null)

// ---------------------------------------------------------------- routines
export interface ProjectRoutine {
  name: string
  schedule: string // "every 30m", "daily 02:30", "on pr: checks-failed, review"
  enabled: boolean
  kind: string // "prompt only", "command: approved"… as herdr-projects words it
  when: string[] // "last …", "next …"… as herdr-projects words them
}
export interface BrokenRoutine { file: string, error: string }
export interface RoutineList { routines: ProjectRoutine[], broken: BrokenRoutine[] }

// argv of `routine list`, the only routine command wherdr runs.
export function routineListArgs(root: string, slug: string): string[] {
  if (!root.startsWith('/')) throw new Error('invalid projects root')
  if (!projectSlugOk(slug)) throw new Error('invalid project')
  return ['--root', root, 'routine', 'list', slug]
}

// Output of `routine list`: `name\tschedule\tenabled|disabled\tkind\twhen`, or
// `file\tconfig-error: …` for a routine file that does not parse, or "no
// routines". A line of another shape is ignored rather than guessed at.
export function parseRoutineList(output: string): RoutineList {
  const routines: ProjectRoutine[] = []
  const broken: BrokenRoutine[] = []
  for (const line of String(output || '').replace(/\r\n?/g, '\n').split('\n')) {
    const cols = line.split('\t')
    if (cols.length === 2 && cols[1]!.startsWith('config-error:')) {
      broken.push({ file: cols[0]!.trim().slice(0, 120), error: cols[1]!.slice('config-error:'.length).trim().slice(0, 300) })
      continue
    }
    if (cols.length !== 5 || !cols[0]!.trim() || (cols[2] !== 'enabled' && cols[2] !== 'disabled')) continue
    routines.push({
      name: cols[0]!.trim().slice(0, 120),
      schedule: cols[1]!.trim().slice(0, 120),
      enabled: cols[2] === 'enabled',
      kind: cols[3]!.trim().slice(0, 160),
      when: cols[4]!.split(' · ').map(s => s.trim().slice(0, 160)).filter(Boolean),
    })
  }
  return { routines, broken }
}
