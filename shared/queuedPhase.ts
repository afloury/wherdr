// wherdr's "queued" message against Claude's screen (ClaudeScreen):
// still in its queue, already sent (turn in progress), or "!" command
// running. The transcript only tells afterwards (a "!" command
// is only written there at the end), the screen right away.
import type { ClaudeScreen } from './types'
import { dropReplyMarker } from './replyQuote'
import { onlyImageTags, photosOnly } from './queuedMatch'

export type QueuedPhase = 'queued' | 'sent' | 'running'

const UPLOAD = '/.cache/herdr-web/uploads/'
// The screen replaces photos with "[Image #1]" and cuts long lines.
const norm = (t: string) => dropReplyMarker(String(t || '').replace(/\[Image #\d+\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
const msgNorm = (t: string) => norm(String(t || '').split('\n').filter(l => !l.includes(UPLOAD)).join('\n'))

// Same message (first 80 characters); or one starts with the other, long
// enough not to confuse "ok" with "ok, go ahead" (cut screen).
function same(a: string, b: string): boolean {
  const x = a.slice(0, 80)
  const y = b.slice(0, 80)
  if (!x || !y) return false
  return x === y || (Math.min(x.length, y.length) >= 24 && (x.startsWith(y) || y.startsWith(x)))
}

const isBash = (t: string) => /^\s*!/.test(t)
const bashNorm = (t: string) => norm(String(t || '').replace(/^\s*!\s*/, ''))

export function queuedPhase(text: string, s: ClaudeScreen | null | undefined): QueuedPhase {
  if (!s) return 'queued'
  // Photos alone: shown as "[Image #1]" alone on the screen.
  if (photosOnly(text)) return s.queued.some(onlyImageTags) || !s.sent || !onlyImageTags(s.sent) ? 'queued' : 'sent'
  const n = msgNorm(text)
  if (!n) return 'queued'
  if (s.queued.some(q => same(n, norm(q)))) return 'queued'
  if (isBash(text)) {
    if (s.shell && same(bashNorm(text), norm(s.shell.command))) return 'running'
    return s.sent && isBash(s.sent) && same(bashNorm(text), bashNorm(s.sent)) ? 'sent' : 'queued'
  }
  return s.sent && !isBash(s.sent) && same(n, norm(s.sent)) ? 'sent' : 'queued'
}

// Phases of a queue in sending order. The screen only keeps the last
// message sent: when Claude takes two messages from its queue at once, only
// the second is recognized there, and it would show as "sent" before the first.
// Rule: a message is only sent if all older ones are. A
// more recent message already sent proves that the older ones outside the
// screen's queue were sent too; an older one still in that queue holds back
// the following ones.
export function queuedPhases(texts: string[], s: ClaudeScreen | null | undefined): QueuedPhase[] {
  const raw = texts.map(t => queuedPhase(t, s))
  const inQueue = texts.map(t => Boolean(s && s.queued.some(q => (photosOnly(t) ? onlyImageTags(q) : same(msgNorm(t), norm(q))))))
  const lastGone = raw.reduce((acc, p, i) => (p !== 'queued' ? i : acc), -1)
  return raw.map((p, i) => {
    if (i > lastGone) return p
    if (inQueue.slice(0, i + 1).some(Boolean)) return 'queued'
    return p === 'queued' ? 'sent' : p
  })
}
