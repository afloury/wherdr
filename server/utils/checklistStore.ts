// The user's ticks on the task lists of an agent's messages, by conversation
// (pane id): DATA_DIR/checklists.json, written atomically, one write at a time.
import path from 'node:path'
import { readJsonOrMissing, writeFileAtomic } from './atomicWrite'
import { DATA_DIR } from './env'
import { HerdrError } from './herdr'
import {
  applySent, applyToggle, sanitizeChecklist,
  type ChecklistItem, type ChecklistMark, type ChecklistState,
} from '../../shared/checklist'

export const CHECKLIST_FILE = path.join(DATA_DIR, 'checklists.json')

const MAX_PANES = 200

interface Store { panes: Record<string, ChecklistState>, touched: Record<string, number> }

// Strict: only a missing file is empty; anything else throws, so a change
// never drops the other conversations.
async function load(file: string): Promise<Store> {
  const raw = (await readJsonOrMissing(file)) as { panes?: unknown, touched?: unknown } | undefined
  const panes: Record<string, ChecklistState> = {}
  const touched: Record<string, number> = {}
  const rawPanes = raw?.panes && typeof raw.panes === 'object' ? raw.panes : {}
  const rawTouched = (raw?.touched && typeof raw.touched === 'object' ? raw.touched : {}) as Record<string, unknown>
  for (const [id, v] of Object.entries(rawPanes)) {
    const state = sanitizeChecklist(v)
    if (!id || !Object.keys(state).length) continue
    panes[id] = state
    touched[id] = typeof rawTouched[id] === 'number' ? rawTouched[id] : 0
  }
  return { panes, touched }
}

export async function readChecklist(paneId: string, file = CHECKLIST_FILE): Promise<ChecklistState> {
  try { return (await load(file)).panes[paneId] ?? {} }
  catch { return {} }
}

const bad = (msg: string) => new HerdrError('bad_input', msg)
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100000

function parseItems(v: unknown): ChecklistItem[] {
  if (!Array.isArray(v) || v.length > 200) throw bad('items: a list of up to 200 items')
  return v.map((i) => {
    const it = i as Partial<ChecklistItem> | null
    if (!it || !isIndex(it.index) || !isIndex(it.group) || typeof it.text !== 'string' || typeof it.written !== 'boolean') throw bad('items: { index, group, text, written }')
    return { index: it.index, group: it.group, text: it.text.slice(0, 200), written: it.written }
  })
}

function parseMarks(v: unknown): ChecklistMark[] {
  if (!Array.isArray(v) || v.length > 200 * 40) throw bad('marks: a list')
  return v.map((i) => {
    const m = i as Partial<ChecklistMark> | null
    if (!m || typeof m.key !== 'string' || !m.key || m.key.length > 200 || !isIndex(m.index) || typeof m.value !== 'boolean') throw bad('marks: { key, index, value }')
    return { key: m.key, index: m.index, value: m.value }
  })
}

let queue: Promise<unknown> = Promise.resolve()

// Applies a toggle or a "sent" to one conversation; returns its new state.
export function updateChecklist(paneId: string, body: Record<string, unknown>, file = CHECKLIST_FILE): Promise<ChecklistState> {
  if (typeof paneId !== 'string' || !paneId || paneId.length > 200) return Promise.reject(bad('pane_id: required'))
  let apply: (s: ChecklistState) => ChecklistState
  if (body.op === 'toggle') {
    const { key, at, index, checked } = body
    if (typeof key !== 'string' || !key || key.length > 200) return Promise.reject(bad('key: required'))
    if (typeof at !== 'number' || !Number.isFinite(at)) return Promise.reject(bad('at: a timestamp'))
    if (!isIndex(index)) return Promise.reject(bad('index: a number'))
    if (typeof checked !== 'boolean') return Promise.reject(bad('checked: true or false'))
    let items: ChecklistItem[]
    try { items = parseItems(body.items) }
    catch (e) { return Promise.reject(e) }
    apply = s => applyToggle(s, key, { at, items }, index, checked)
  }
  else if (body.op === 'sent') {
    let marks: ChecklistMark[]
    try { marks = parseMarks(body.marks) }
    catch (e) { return Promise.reject(e) }
    apply = s => applySent(s, marks)
  }
  else return Promise.reject(bad('op: toggle or sent'))

  const run = queue.then(async () => {
    const store = await load(file)
    const state = sanitizeChecklist(apply(store.panes[paneId] ?? {}))
    store.panes[paneId] = state
    store.touched[paneId] = Math.max(Date.now(), ...Object.values(store.touched)) + 1
    const ids = Object.keys(store.panes).sort((a, b) => (store.touched[b] ?? 0) - (store.touched[a] ?? 0)).slice(0, MAX_PANES)
    const keep = new Set(ids)
    for (const id of Object.keys(store.panes)) {
      if (!keep.has(id)) {
        delete store.panes[id]
        delete store.touched[id]
      }
    }
    await writeFileAtomic(file, JSON.stringify({ v: 1, panes: store.panes, touched: store.touched }) + '\n')
    return state
  })
  queue = run.catch(() => {})
  return run
}
