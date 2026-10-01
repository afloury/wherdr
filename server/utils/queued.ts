// Messages sent from the phone and shown as "queued": when
// did the agent take them?
import type { ChatItem, QueuedMessage } from '../../shared/types'

export const QUEUED_TTL_MS = 60 * 60 * 1000
// Sent photo ("<home>/.cache/herdr-web/uploads/<name>" line of a message).
export const isUploadLine = (l: string) => l.includes('/.cache/herdr-web/uploads/')
const norm = (t: unknown) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
// "! cmd": Claude Code switches to bash mode and only writes "cmd" (<bash-input>).
export const bashText = (t: string) => String(t || '').replace(/^\s*!\s*/, '')

// Taken by the agent = a user message in the transcript, written after
// sending, that contains the start of the text (Claude may group several
// queued messages into a single turn). Text modified by the agent: when idle,
// a user message written after sending followed by a reply is enough.
export function queuedDone(q: { text: string, at: number }, items: ChatItem[], idle: boolean, now: number): boolean {
  if (now - q.at > QUEUED_TTL_MS) return true
  const users = items.filter(i => i.role === 'user' || i.role === 'cmd' || i.role === 'bash')
  // Photo paths become images in the transcript.
  const needle = norm(q.text.split('\n').filter(l => !isUploadLine(l)).join(' ')).slice(0, 80)
  const bashNeedle = norm(bashText(q.text)).slice(0, 80)
  if (users.some(u => (!u.ts || Date.parse(u.ts) >= q.at - 10000)
    && (u.role === 'bash' ? Boolean(bashNeedle) && norm(u.text).includes(bashNeedle)
      : needle ? norm(u.text).includes(needle) : (u.images || 0) > 0))) return true
  if (!idle) return false
  const i = items.findIndex(u => u.role === 'user' && u.ts && Date.parse(u.ts) > q.at)
  return i >= 0 && items.slice(i + 1).some(a => a.role === 'assistant')
}

// Messages sent while a menu or panel hides the agent's input field (an
// interactive /mcp, /hooks… flow): typed into it, they would be lost. They are
// held here and delivered, in order, as soon as the input is visible again.
// A message that was delivered but never shows up in the transcript while the
// agent sits ready is reported as failed, with Retry / Cancel, instead of
// staying "sending…" forever.
export const HOLD_TTL_MS = 10 * 60 * 1000
export const LOST_MS = 60 * 1000
export const HOLD_AGENTS = new Set(['claude', 'codex'])
// Agent at rest, whose input field may be checked on screen (see closePanel).
export const INPUT_STATES = new Set(['idle', 'done', 'unknown'])

export interface QueueEntry {
  id: string
  text: string
  at: number
  held?: boolean
  failed?: boolean
  // Since when the agent has been ready with this message delivered.
  readySince?: number
}

// Hold a new message instead of typing it now?
export function shouldHold(agent: string | null | undefined, status: string | null | undefined, input: boolean, earlierHeld: boolean): boolean {
  if (!agent || !HOLD_AGENTS.has(agent)) return false
  // Keep the order: behind a held message, everything waits.
  if (earlierHeld) return true
  return INPUT_STATES.has(status || '') && !input
}

// Next held message to deliver: the oldest one, and only when nothing older
// is still held (a failed one is skipped: it waits for Retry or Cancel).
export function nextHeld(list: QueueEntry[]): QueueEntry | null {
  return list.find(q => q.held && !q.failed) || null
}

// Updates timers in place on each poll; true when an entry just failed.
export function checkQueue(list: QueueEntry[], status: string | null | undefined, now: number): boolean {
  let changed = false
  const ready = status === 'idle' || status === 'done'
  for (const q of list) {
    if (q.failed) continue
    if (q.held) {
      if (now - q.at > HOLD_TTL_MS) { q.failed = true; changed = true }
      continue
    }
    if (!ready) { delete q.readySince; continue }
    q.readySince ??= now
    if (now - Math.max(q.readySince, q.at) > LOST_MS) { q.failed = true; changed = true }
  }
  return changed
}

// Fields the app sees.
export const publicEntry = (q: QueueEntry): QueuedMessage => ({
  id: q.id, text: q.text, at: q.at,
  ...(q.held && !q.failed ? { state: 'held' as const } : {}),
  ...(q.failed ? { state: 'failed' as const } : {}),
})
