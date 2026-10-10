// Pasted texts of the messages sent from wherdr's field, kept for every
// device. No transcript tells them from typed words (Claude Code wraps the
// whole send in one <pasted_content>, Codex and omp keep plain text): the app
// says where they sit in the message it sends, and the conversation served to
// all devices lists them (ChatItem.pasted), so each one shows the same cards
// (see shared/pastedText.ts).
// Kept in data/pastes.json, most recent first, bounded in number and size:
// the oldest go, and their messages become plain text again.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { QueuedMessage } from '../../shared/types'
import { isLongPaste, splitPasted } from '../../shared/pastedText'
import { DATA_DIR } from './env'

export const PASTES_MAX = 100
export const PASTES_MAX_CHARS = 2_000_000
// Ranges read from one request.
const PER_MESSAGE = 20

// The pasted texts of `text` at the [start, length] ranges the app gave:
// long blocks only, each one once. Anything malformed is ignored.
export function pastesAt(text: string, ranges: unknown): string[] {
  if (!Array.isArray(ranges)) return []
  const out: string[] = []
  for (const r of ranges.slice(0, PER_MESSAGE)) {
    if (!Array.isArray(r)) continue
    const [at, len] = r as unknown[]
    if (typeof at !== 'number' || typeof len !== 'number' || !Number.isInteger(at) || !Number.isInteger(len)) continue
    if (at < 0 || len <= 0 || at + len > text.length) continue
    const b = text.slice(at, at + len).trim()
    if (isLongPaste(b) && !out.includes(b)) out.push(b)
  }
  return out
}

// The list with `blocks` first. The same list (same array) when nothing changes.
export function addPastes(list: string[], blocks: string[]): string[] {
  if (!blocks.length) return list
  let total = 0
  const next = [...blocks, ...list.filter(s => !blocks.includes(s))].slice(0, PASTES_MAX).filter((s) => {
    total += s.length
    return total <= PASTES_MAX_CHARS
  })
  return next.length === list.length && next.every((s, i) => s === list[i]) ? list : next
}

// Blocks read back from data/pastes.json: well-formed ones, within the bounds.
export function loadPastes(raw: unknown): string[] {
  return Array.isArray(raw) ? addPastes([], raw.filter((s): s is string => typeof s === 'string' && isLongPaste(s))) : []
}

// Pasted texts of a user message: the blocks its transcript lists (`listed`)
// and the kept ones found in it, the longest first (a kept block may sit
// inside another one), in the order of the text. Only text of the message
// itself: a kept block that merely starts like it is another message's, and
// of a text cut short, the part it holds.
export function pastedIn(list: string[], text: string, listed: string[] = []): string[] {
  if (!list.length || !isLongPaste(text)) return listed
  const known = list.filter(b => !listed.includes(b)).sort((a, b) => b.length - a.length)
  return splitPasted(text, listed, known).pastes
}

// The conversation with the pasted texts of its user messages listed.
export function withPasted<T extends { role: string, text: string, pasted?: string[] }>(items: T[], list: string[]): T[] {
  if (!list.length) return items
  return items.map((i) => {
    if (i.role !== 'user') return i
    const pasted = pastedIn(list, i.text, i.pasted)
    return pasted.length && pasted !== i.pasted ? { ...i, pasted } : i
  })
}

// A queued record with its pasted texts: what its text, cut short, holds of them.
export function withQueuedPasted(q: QueuedMessage, list: string[]): QueuedMessage {
  const pasted = pastedIn(list, q.text)
  return pasted.length ? { ...q, pasted } : q
}

const PASTES_FILE = path.join(DATA_DIR, 'pastes.json')
let kept: string[] | null = null
function pastes(): string[] {
  if (kept) return kept
  try { kept = loadPastes(JSON.parse(fs.readFileSync(PASTES_FILE, 'utf8'))) } catch { kept = [] }
  return kept
}

// Written to a temporary file then renamed (a reader never sees half a file,
// which would read as an empty list), one write after the other: the latest
// list, whatever sends came in meanwhile.
let saved: string[] | null = null
let writing: Promise<unknown> = Promise.resolve()
function save() {
  writing = writing.then(async () => {
    const list = kept
    if (!list || list === saved) return
    const temp = `${PASTES_FILE}.${randomUUID()}.tmp`
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true })
      await fsp.writeFile(temp, JSON.stringify(list) + '\n', { mode: 0o600 })
      await fsp.rename(temp, PASTES_FILE)
      saved = list
    } catch {
      await fsp.rm(temp, { force: true }).catch(() => {})
    }
  })
}

// A message sent from the app: its pasted texts are kept. Written only when
// the list changes (never for a message without a paste).
export function keepPastes(text: string, ranges: unknown) {
  const next = addPastes(pastes(), pastesAt(text, ranges))
  if (next === kept) return
  kept = next
  save()
}
export const chatPasted = <T extends { role: string, text: string, pasted?: string[] }>(items: T[]) => withPasted(items, pastes())
export const queuedPasted = (q: QueuedMessage) => withQueuedPasted(q, pastes())
