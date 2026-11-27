// Task-list checkboxes (`- [ ]` / `- [x]`) of an agent's message: the user's ticks
// per message, and the block the next reply carries. The items are the boxes the page
// rendered (app/utils/checklistDom.ts): one source, so a tick never lands on another item.
// Pure: shared by the server store and the app.

export interface ChecklistItem { index: number, text: string, written: boolean }
export interface ChecklistItemState { text: string, written: boolean, checked: boolean, sent: boolean }
export interface ChecklistMessage { at: number, items: Record<string, ChecklistItemState> }
export type ChecklistState = Record<string, ChecklistMessage>
export interface ChecklistMark { key: string, index: number, value: boolean }

const MAX_MESSAGES = 40
const MAX_ITEMS = 200
export const MAX_TEXT = 200
const MAX_KEY = 200
const LINE_TEXT = 60

function clone(state: ChecklistState): ChecklistState {
  const out: ChecklistState = {}
  for (const [k, m] of Object.entries(state)) {
    out[k] = { at: m.at, items: Object.fromEntries(Object.entries(m.items).map(([i, s]) => [i, { ...s }])) }
  }
  return out
}

// The message's items as the page rendered them now: an item kept at its place keeps its
// state, a new or changed one starts as the agent wrote it (a reply that grew after a tick).
export function applyToggle(state: ChecklistState, key: string, msg: { at: number, items: ChecklistItem[] }, index: number, checked: boolean): ChecklistState {
  const next = clone(state)
  const old = next[key]?.items ?? {}
  const items: Record<string, ChecklistItemState> = {}
  for (const i of msg.items.slice(0, MAX_ITEMS)) {
    const was = old[String(i.index)]
    items[String(i.index)] = was && was.text === i.text && was.written === i.written
      ? was
      : { text: i.text, written: i.written, checked: i.written, sent: i.written }
  }
  next[key] = { at: msg.at, items: msg.items.length ? items : old }
  const item = next[key].items[String(index)]
  if (item) item.checked = checked
  return next
}

type Changed = { key: string, at: number, items: (ChecklistItemState & { index: number })[] }

// Only the user's own changes not sent yet: an item the agent ticked itself, or one
// already sent as it is, is left out.
export function changedItems(state: ChecklistState): Changed[] {
  const out: Changed[] = []
  for (const [key, m] of Object.entries(state)) {
    const items = Object.entries(m.items).map(([i, s]) => ({ ...s, index: Number(i) }))
      .filter(i => i.checked !== i.sent).sort((a, b) => a.index - b.index)
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
      changed++
    }
  }
  return { ticked, changed }
}

const short = (s: string) => (s.length > LINE_TEXT ? s.slice(0, LINE_TEXT - 1).trimEnd() + '…' : s)

export function checklistBlock(state: ChecklistState, time: (ms: number) => string): { text: string, marks: ChecklistMark[] } | null {
  const sections: string[] = []
  const marks: ChecklistMark[] = []
  for (const m of changedItems(state)) {
    // A message without a time (its transcript had none) is named without one.
    const lines = [m.at > 0 ? `Checklist from your ${time(m.at)} message:` : 'Checklist from your message:']
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
      if (typeof it.text !== 'string') continue
      if (typeof it.written !== 'boolean' || typeof it.checked !== 'boolean' || typeof it.sent !== 'boolean') continue
      items.push([Number(i), { text: it.text.slice(0, MAX_TEXT), written: it.written, checked: it.checked, sent: it.sent }])
    }
    if (!items.length) continue
    items.sort((a, b) => a[0] - b[0])
    msgs.push([key, { at: m.at, items: Object.fromEntries(items.slice(0, MAX_ITEMS).map(([i, s]) => [String(i), s])) }])
  }
  msgs.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(msgs.slice(0, MAX_MESSAGES))
}

// A conversation's ticks are polled (other devices' ticks show) only while it is on
// screen, the page is visible, and a recent reply holds a task list or ticks wait to be
// sent; otherwise it is read once when it opens or the page comes back. A tick itself is
// written at once, whatever this says.
export function shouldPollChecklist(c: { onScreen: boolean, visible: boolean, recent: boolean, unsent: boolean }): boolean {
  return c.onScreen && c.visible && (c.recent || c.unsent)
}
