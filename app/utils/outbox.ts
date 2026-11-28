// Messages shown in the conversation from the tap on Send, before the server
// answers (see composables/useOutbox.ts). Each one has an id made here
// ("w-…"), which the server keeps for its own record of the message: the bubble keeps its identity from the tap
// until it lands in the transcript, with no duplicate and no jump.
import type { QueuedMessage } from '../../shared/types'

export interface OutboxItem extends Omit<QueuedMessage, 'state'> {
  // 'sending': the server has not answered yet.
  state?: QueuedMessage['state'] | 'sending'
  // The server never got it (network, refusal): Retry / Cancel stay here.
  local?: boolean
  // When the server answered (a slow send must not shorten its stay).
  settledAt?: number
  // When a state first no longer listed this record (the agent took it).
  goneAt?: number
  // Saved while sending (see toSave): it may have reached the agent.
  unsure?: boolean
}

// A record the server no longer lists (the agent took the message) stays
// until a transcript read that started this long after it left: the message
// is in the conversation by then (shown there, see pendingQueue.ts) or it will
// never be (typed into a menu…). Until such a read, it stays: a slow or failing
// read of the conversation must not make a sent message vanish.
export const SETTLED_MS = 10000
// Never re-read (conversation not open, reads failing for that long): it goes anyway.
export const GONE_MAX_MS = 5 * 60_000

let seq = 0
export const newOutboxId = () => `w-${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`

export function addSending(list: OutboxItem[], id: string, text: string, at: number): OutboxItem[] {
  return [...list, { id, text, at, state: 'sending' }]
}

// The server answered: its record replaces the bubble (same id; the time of
// the tap is kept, so messages typed in a row stay in order). No record
// (herdr-core keeps no queue: the message was typed into the agent): the
// bubble stays as a sent message, unlisted, until the transcript has been read
// again (see prune) — it shows there once in it (see pendingQueue.ts).
export function settle(list: OutboxItem[], id: string, server: QueuedMessage | null, now: number): OutboxItem[] {
  return list.map(q => (q.id !== id ? q : server ? { ...server, id, at: q.at ?? server.at, settledAt: now } : { id, text: q.text, at: q.at, settledAt: now }))
}

// The request failed: the bubble stays, "Not sent", with Retry / Cancel.
export function failLocal(list: OutboxItem[], id: string): OutboxItem[] {
  return list.map(q => (q.id === id ? { id: q.id, text: q.text, at: q.at, state: 'failed', local: true } : q))
}

// Retry of a message the server never got: sending again, same bubble.
export function resend(list: OutboxItem[], id: string): OutboxItem[] {
  return list.map(q => (q.id === id ? { id: q.id, text: q.text, at: q.at, state: 'sending' } : q))
}

// A new server state: the records it lists win (shown from its state from now
// on); records it returned but no longer lists go after a read of the
// conversation made long enough after they left (`readAt`: when the last
// successful read of this conversation started, see SETTLED_MS). A bubble
// still sending only goes on its own outcome. A bubble whose request failed
// stays "Not sent", unless the server lists it: then it got the message after
// all (the answer was lost on the way), and its record decides from now on,
// so that once the message lands the old "Not sent" does not come back.
export function prune(list: OutboxItem[], server: QueuedMessage[], now: number, readAt = 0): OutboxItem[] {
  const known = new Set(server.map(q => q.id))
  const out: OutboxItem[] = []
  for (const q of list) {
    if (q.state === 'sending') out.push(q)
    // Held on the server for a Codex not ready yet: the local copy stays until
    // it is typed, or comes back into the field (see returnHeld).
    else if (known.has(q.id)) { if (q.state === 'held') out.push(q) }
    else if (q.local) out.push(q)
    else {
      // No longer listed, Codex still there: typed. Never "held" again.
      const left = q.state === 'held' ? { ...q, state: undefined } : q
      const gone = left.goneAt ?? Math.max(now, left.settledAt ?? left.at ?? 0)
      if (readAt - gone >= SETTLED_MS || now - gone >= GONE_MAX_MS) continue
      out.push(left.goneAt === gone && left === q ? q : { ...left, goneAt: gone })
    }
  }
  return out
}

// What outlives a page reload (useOutbox.ts keeps it in localStorage): the
// messages the user still has to act on. "Not sent" (the server never got it)
// comes back as it is, with Retry / Cancel; "Sending…" whose answer the reload
// lost may have been typed, so it is marked `unsure`: it comes back into the
// message field for the user to check, never sent again by itself or by Retry.
// A confirmed message (the server answered) is not kept.
export type SavedOutbox = Record<string, OutboxItem[]>
export function toSave(list: OutboxItem[]): OutboxItem[] {
  return list.filter(q => q.local || q.state === 'sending')
    .map(q => ({ id: q.id, text: q.text, at: q.at, state: 'failed' as const, local: true, ...(q.unsure || q.state === 'sending' ? { unsure: true } : {}) }))
}
export function fromSaved(raw: unknown): { boxes: SavedOutbox, back: SavedOutbox } {
  const boxes: SavedOutbox = {}, back: SavedOutbox = {}
  if (!raw || typeof raw !== 'object') return { boxes, back }
  for (const [paneId, list] of Object.entries(raw as Record<string, unknown>)) {
    const ok = savedItems(list)
    const kept = ok.filter(q => !q.unsure).map(q => ({ id: q.id, text: q.text, at: q.at, state: 'failed' as const, local: true }))
    const lost = ok.filter(q => q.unsure).map(q => ({ id: q.id, text: q.text, unsure: true }))
    if (kept.length) boxes[paneId] = kept
    if (lost.length) back[paneId] = lost
  }
  return { boxes, back }
}
const savedItems = (list: unknown): OutboxItem[] => (Array.isArray(list) ? list.filter((q): q is OutboxItem => Boolean(q) && typeof q.id === 'string' && typeof q.text === 'string') : [])
// Several tabs share the stored list of a conversation: a tab replaces only the
// records it owns (made or loaded there, `owned`), another tab's stay as they are.
export function mergeSaved(stored: unknown, owned: Set<string>, mine: OutboxItem[]): OutboxItem[] {
  return [...savedItems(stored).filter(q => !owned.has(q.id)), ...mine]
}

// Messages held on the server for Codex (coreHeld.ts) that come back as texts,
// for the message field. Codex gone (`gone`: exited, or stopped by its update):
// the server dropped them, so those it no longer lists. Codex still there: only
// those it lists as 'unseen' (their send timed out, they may have reached Codex);
// one it no longer lists was typed.
export function returnHeld(list: OutboxItem[], server: QueuedMessage[], gone = true): { kept: OutboxItem[], back: string[] } {
  const known = new Set(server.map(q => q.id))
  const unseen = new Set(server.filter(q => q.reason === 'unseen').map(q => q.id))
  const back = list.filter(q => q.state === 'held' && !q.local && (gone ? !known.has(q.id) : unseen.has(q.id)))
  return { kept: list.filter(q => !back.includes(q)), back: back.map(q => q.text) }
}

// What the conversation shows: the server's records (its state wins), then the
// app's bubbles it does not list yet.
export function withOutbox(server: QueuedMessage[], local: OutboxItem[]): OutboxItem[] {
  return [...server, ...local.filter(q => !server.some(x => x.id === q.id))]
}

// A dictation app pastes the text and presses Enter for the user; when the
// page lags, that can happen more than once for one message. A submit whose
// text is exactly the one sent to the same conversation less than REPEAT_MS
// ago is that echo, not a new message. Any change in the text sends.
export const REPEAT_MS = 3000

export interface RecentSend { text: string, at: number }

// The sends still recent enough to catch an echo.
export function recentSends(list: RecentSend[], now: number): RecentSend[] {
  return list.filter(s => now - s.at < REPEAT_MS && s.at <= now)
}

export function isRepeat(list: RecentSend[], text: string, now: number): boolean {
  return recentSends(list, now).some(s => s.text === text)
}

// Sends of a conversation go one after the other. Each waits for the earlier
// one whatever its outcome, so a message behind a failed one still goes. A
// send with no answer after SEND_DEADLINE_MS fails ("Not sent", Retry /
// Cancel), so the ones behind it never wait for good. The server answers
// within about 80 s at worst (herdr-core's send, the wait for a photo, the
// Enters, WHR-454): this only catches a request lost on the way. The send
// itself runs on the server and goes on whatever the page does.
export const SEND_DEADLINE_MS = 120000

export class SendTimeout extends Error {
  constructor() {
    super('No answer from the server')
    this.name = 'SendTimeout'
  }
}

export function chainSend<T>(prev: Promise<unknown> | undefined, send: (signal: AbortSignal) => Promise<T>, ms = SEND_DEADLINE_MS): Promise<T> {
  return (prev || Promise.resolve()).catch(() => {}).then(() => {
    const ctl = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    // Also when `send` does not honour the signal.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new SendTimeout()
        ctl.abort(err)
        reject(err)
      }, ms)
    })
    return Promise.race([send(ctl.signal), deadline]).finally(() => clearTimeout(timer))
  })
}
