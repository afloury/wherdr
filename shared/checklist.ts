// Task-list checkboxes (`- [ ]` / `- [x]`) of an agent's message: parsing them,
// the user's ticks per message, and the block the next reply carries.
// Pure: shared by the server store and the app.

export interface ChecklistItem { index: number, group: number, text: string, written: boolean }
export interface ChecklistItemState { group: number, text: string, written: boolean, checked: boolean, sent: boolean }
export interface ChecklistMessage { at: number, items: Record<string, ChecklistItemState> }
export type ChecklistState = Record<string, ChecklistMessage>
export interface ChecklistMark { key: string, index: number, value: boolean }

const MAX_MESSAGES = 40
const MAX_ITEMS = 200
const MAX_TEXT = 200
const MAX_KEY = 200
const LINE_TEXT = 60
const SEP = ' › '

const FENCE = /^\s*(`{3,}|~{3,})/
const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])(?:\s+(.*)|\s*)$/
const TASK = /^\[([ xX])\](?:\s+(.*)|\s*)$/

// A label without its inline markup (emphasis, code, links).
function plain(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|[*`])/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const indentOf = (ws: string) => ws.replace(/\t/g, '    ').length

export function parseChecklist(markdown: string): ChecklistItem[] {
  const out: ChecklistItem[] = []
  let fence: { ch: string, len: number } | null = null
  let stack: { indent: number, label: string }[] = []
  let group = 0
  let gap = true // no list is open: the next indent-0 item starts a group
  for (const line of String(markdown).split(/\r?\n/)) {
    const f = FENCE.exec(line)
    if (fence) {
      if (f && f[1]![0] === fence.ch && f[1]!.length >= fence.len && !line.replace(FENCE, '').trim()) fence = null
      continue
    }
    if (f) {
      fence = { ch: f[1]![0]!, len: f[1]!.length }
      continue
    }
    if (!line.trim()) {
      gap = true
      continue
    }
    const m = LIST_ITEM.exec(line)
    if (!m) {
      // Indented text continues the open item; anything else ends the list.
      if (!/^\s/.test(line)) {
        stack = []
        gap = true
      }
      continue
    }
    const indent = indentOf(m[1]!)
    if (indent === 0 && gap) {
      stack = []
      group++
    }
    else if (!stack.length && gap) group++
    gap = false
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop()
    const body = (m[2] ?? '').trim()
    const t = TASK.exec(body)
    const label = plain(t ? (t[2] ?? '') : body)
    if (t) {
      const text = [...stack.map(s => s.label), label].filter(Boolean).join(SEP).slice(0, MAX_TEXT)
      out.push({ index: out.length, group, text, written: t[1] !== ' ' })
    }
    stack.push({ indent, label })
  }
  return out
}

function clone(state: ChecklistState): ChecklistState {
  const out: ChecklistState = {}
  for (const [k, m] of Object.entries(state)) {
    out[k] = { at: m.at, items: Object.fromEntries(Object.entries(m.items).map(([i, s]) => [i, { ...s }])) }
  }
  return out
}

export function applyToggle(state: ChecklistState, key: string, msg: { at: number, items: ChecklistItem[] }, index: number, checked: boolean): ChecklistState {
  const next = clone(state)
  if (!next[key]) {
    next[key] = {
      at: msg.at,
      items: Object.fromEntries(msg.items.map(i => [String(i.index), { group: i.group, text: i.text, written: i.written, checked: i.written, sent: i.written }])),
    }
  }
  const item = next[key].items[String(index)]
  if (item) item.checked = checked
  return next
}

type Changed = { key: string, at: number, items: (ChecklistItemState & { index: number })[] }

export function changedItems(state: ChecklistState): Changed[] {
  const out: Changed[] = []
  for (const [key, m] of Object.entries(state)) {
    const all = Object.entries(m.items).map(([i, s]) => ({ ...s, index: Number(i) })).sort((a, b) => a.index - b.index)
    const groups = new Set(all.filter(i => i.checked !== i.sent).map(i => i.group))
    const items = all.filter(i => groups.has(i.group))
    if (items.length) out.push({ key, at: m.at, items })
  }
  return out.sort((a, b) => a.at - b.at)
}

export function checklistCounts(state: ChecklistState): { ticked: number, changed: number } {
  let ticked = 0
  let changed = 0
  for (const m of changedItems(state)) {
    for (const i of m.items) {
      if (i.checked) ticked++
      if (i.checked !== i.sent) changed++
    }
  }
  return { ticked, changed }
}

const short = (s: string) => (s.length > LINE_TEXT ? s.slice(0, LINE_TEXT - 1).trimEnd() + '…' : s)

export function checklistBlock(state: ChecklistState, time: (ms: number) => string): { text: string, marks: ChecklistMark[] } | null {
  const sections: string[] = []
  const marks: ChecklistMark[] = []
  for (const m of changedItems(state)) {
    const lines = [`Checklist from your ${time(m.at)} message:`]
    for (const i of m.items) {
      lines.push(`[${i.checked ? 'x' : ' '}] ${short(i.text)}`)
      marks.push({ key: m.key, index: i.index, value: i.checked })
    }
    sections.push(lines.join('\n'))
  }
  return sections.length ? { text: sections.join('\n\n'), marks } : null
}

export function applySent(state: ChecklistState, marks: ChecklistMark[]): ChecklistState {
  const next = clone(state)
  for (const k of marks) {
    const item = next[k.key]?.items[String(k.index)]
    if (item) item.sent = k.value
  }
  return next
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

export function sanitizeChecklist(raw: unknown): ChecklistState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const msgs: [string, ChecklistMessage][] = []
  for (const [key, v] of Object.entries(raw)) {
    const m = v as { at?: unknown, items?: unknown } | null
    if (!key || key.length > MAX_KEY || !m || typeof m !== 'object') continue
    if (typeof m.at !== 'number' || !Number.isFinite(m.at)) continue
    if (!m.items || typeof m.items !== 'object' || Array.isArray(m.items)) continue
    const items: [number, ChecklistItemState][] = []
    for (const [i, s] of Object.entries(m.items)) {
      const it = s as Partial<ChecklistItemState> | null
      if (!/^\d{1,6}$/.test(i) || !it || typeof it !== 'object') continue
      if (!isInt(it.group) || typeof it.text !== 'string') continue
      if (typeof it.written !== 'boolean' || typeof it.checked !== 'boolean' || typeof it.sent !== 'boolean') continue
      items.push([Number(i), { group: it.group, text: it.text.slice(0, MAX_TEXT), written: it.written, checked: it.checked, sent: it.sent }])
    }
    if (!items.length) continue
    items.sort((a, b) => a[0] - b[0])
    msgs.push([key, { at: m.at, items: Object.fromEntries(items.slice(0, MAX_ITEMS).map(([i, s]) => [String(i), s])) }])
  }
  msgs.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(msgs.slice(0, MAX_MESSAGES))
}
