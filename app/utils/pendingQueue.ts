// Messages sent but not yet in the conversation (dotted bubbles under it):
// wherdr's own records (server and local sends) + Claude's own queue
// (messages typed on the computer while it works), without duplicates, each
// with its photos and its phase (see shared/queuedPhase.ts).
//
// Photos alone have no text: their record is matched by its photos (see
// shared/queuedMatch.ts). Claude's queue only keeps "[Image #1]": an entry of
// it gets the photos of wherdr's record of the same message, even one the
// server no longer lists (remembered here).
import type { ChatItem, ClaudeQueueEntry, ClaudeScreen, QueuedMessage } from '../../shared/types'
import { type QueuedPhase, queuedPhases } from '../../shared/queuedPhase'
import { photosLanded, photosOnly, uploadNames, withoutUploads } from '../../shared/queuedMatch'
import { dropReplyMarker } from '../../shared/replyQuote'

export interface PendingMessage {
  id: string
  // Text as sent (photo lines included), for Cancel.
  raw: string
  // Sent from wherdr (Claude's own entries have ids "cc-…").
  mine: boolean
  phase: QueuedPhase
  state: 'held' | 'failed' | null
  // Stored names of its photos.
  photos: string[]
  // Photos Claude's queue counts but whose files are unknown.
  missing: number
}

const normText = (s: string) => dropReplyMarker(String(s || '').replace(/\s+/g, ' ').trim().toLowerCase())

// Records with photos seen for a pane (most recent last), to give Claude's
// entries their photos. Plain memory of this page, outside reactivity.
const MEMORY = 30
const memories = new Map<string, QueuedMessage[]>()
export function rememberSent(paneId: string, list: QueuedMessage[]): QueuedMessage[] {
  const out = (memories.get(paneId) || []).filter(m => !list.some(q => q.id === m.id))
  out.push(...list.filter(q => uploadNames(q.text).length))
  memories.set(paneId, out.slice(-MEMORY))
  return memories.get(paneId)!
}

export function pendingQueue(o: {
  mine: QueuedMessage[]
  claude: ClaudeQueueEntry[]
  items: ChatItem[]
  screen: ClaudeScreen | null
  memory?: QueuedMessage[]
}): PendingMessage[] {
  // Already in the conversation (the server has not noticed yet): we do not
  // show two copies. "! cmd" appears there as a command without "!".
  const inChat = (q: QueuedMessage) => {
    const after = (i: ChatItem) => !q.at || !i.ts || Date.parse(i.ts) >= q.at - 10000
    if (photosOnly(q.text)) return o.items.some(i => after(i) && photosLanded(q.text, i))
    const n = normText(withoutUploads(q.text)).slice(0, 60)
    const nb = normText(q.text.replace(/^\s*!\s*/, '')).slice(0, 60)
    return Boolean(n) && o.items.some(i => after(i)
      && (i.role === 'user' ? normText(i.text).includes(n) : i.role === 'bash' && Boolean(nb) && normText(i.text).includes(nb)))
  }
  // Sending order, whatever the source (server or local send).
  const mine = [...o.mine].sort((a, b) => (a.at && b.at ? a.at - b.at : 0))
  const list: (QueuedMessage & { missing?: number })[] = mine.filter(q => !inChat(q))
  // Claude's entries: one of wherdr's records (listed, or already in the
  // conversation) is the same message. Photos alone: one entry per record
  // still waiting in Claude's queue (not held here, not already sent).
  const minePhases = queuedPhases(list.map(q => q.text), o.screen)
  let ownPhotos = list.filter((q, i) => photosOnly(q.text) && !q.state && minePhases[i] === 'queued').length
  const memPhotos = (o.memory || []).filter(m => photosOnly(m.text) && !mine.some(q => q.id === m.id))
  for (const q of o.claude) {
    const images = q.images || 0
    if (!q.text) {
      if (!images) continue
      if (ownPhotos > 0) { ownPhotos--; continue }
      const known = memPhotos.shift()
      list.push({ id: `cc-${q.ts}`, text: known ? known.text : '', missing: known ? 0 : images })
      continue
    }
    const n = normText(q.text).slice(0, 60)
    if (!n || mine.some(x => normText(x.text).includes(n))) continue
    const known = images ? [...(o.memory || [])].reverse().find(m => normText(withoutUploads(m.text)).includes(n)) : null
    list.push({ id: `cc-${q.ts}`, text: known ? known.text : q.text, missing: known ? 0 : images })
  }
  const phases = queuedPhases(list.map(q => q.text), o.screen)
  return list.map((q, i) => ({
    id: q.id,
    raw: q.text,
    mine: !q.id.startsWith('cc-'),
    // Held or failed on the server: never typed yet, so never "sent".
    phase: q.state ? 'queued' : phases[i]!,
    state: q.state || null,
    photos: uploadNames(q.text),
    missing: q.missing || 0,
  }))
}
