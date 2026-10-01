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
export function queuedDone(q: Required<QueuedMessage>, items: ChatItem[], idle: boolean, now: number): boolean {
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
