import type { ChatItem, ChatResponse, ClaudeQueueEntry } from '#shared/types'

// Bottom of the conversation after a re-read. With `keep` (incremental reply,
// see server/utils/chatDelta.ts) the first `keep` items stay as they are (same
// objects, so Vue has nothing to redo for them) and the reply's items replace
// the rest. null: the reply does not fit the list held here, reload in full.
export function nextTail(tail: ChatItem[], r: Pick<ChatResponse, 'items' | 'keep'>): ChatItem[] | null {
  const items = r.items || []
  if (r.keep === undefined) return items
  if (!Number.isInteger(r.keep) || r.keep < 0 || r.keep > tail.length) return null
  return r.keep === tail.length && !items.length ? tail : tail.slice(0, r.keep).concat(items)
}

// Same value, structurally — plain JSON data (objects field by field, lists
// item by item): what the transcript and the queue are made of.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  }
  const ka = Object.keys(a), kb = Object.keys(b)
  return ka.length === kb.length && ka.every(k => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

// The bottom list after a re-read, reconciled with the one shown: position by
// position, an item equal in every field (nested `omp`, `job`, `hashes`,
// `pasted`… included) keeps the object already rendered, so nothing it drew
// is redone. All equal and same length: the current array itself, so the
// caller can tell nothing changed and leave the whole view as it is.
export function reconcileTail(current: ChatItem[], next: ChatItem[]): ChatItem[] {
  if (current === next) return current
  let equal = current.length === next.length
  const out = next.map((n, i) => {
    const c = current[i]
    if (c && sameValue(c, n)) return c
    equal = false
    return n
  })
  return equal ? current : out
}

// The messages queued under the conversation, structurally: a re-read
// reporting the same entries changes nothing it shows.
export function sameQueue(a: ClaudeQueueEntry[], b: ClaudeQueueEntry[]): boolean {
  return a.length === b.length && a.every((q, i) => sameValue(q, b[i]))
}

// Whether a reply means starting again from the bottom, dropping the older
// pages loaded above: another file (/clear, new session), or a bottom the
// server read from another byte. The latter happens when the file grew more
// than 24 MB past our start (the server then reads back from the end) or
// became shorter than our start; the older pages would not join the new
// bottom. Keeping them across a 24 MB jump would need each message's byte
// position (left for later): the reading position is lost in that case.
// `rewritten`: the file was rewritten above our start (same size or shorter,
// see anchorOf in server/utils/transcripts.ts), even if the new bottom happens
// to start at the same byte.
export function restartsTail(c: { file: string | null, tailStart: number | null }, r: Pick<ChatResponse, 'file' | 'start' | 'rewritten'>): boolean {
  return Boolean(c.file && r.file !== c.file)
    || Boolean(c.file && r.rewritten)
    || (c.tailStart !== null && r.start !== undefined && r.start !== c.tailStart)
}

// Query of a re-read of the bottom: the token and item count of the list held
// here let the server send only what changed.
// `n` also tells the server this client splices incremental replies (other
// readers of /api/chat, such as plugins, get full lists and are not remembered).
export function tailQuery(pane: string, c: { token: string, tailStart: number | null, tail: ChatItem[] }): URLSearchParams {
  const q = new URLSearchParams({ pane, since: c.token })
  if (c.tailStart !== null) q.set('from', String(c.tailStart))
  q.set('n', String(c.token ? c.tail.length : 0))
  return q
}

// A bottom read unanswered past this is dead (a black-holed fetch after the
// server went away mid-request): aborting frees the one-at-a-time lock below
// so the next poll can ask again, instead of every refresh waiting forever
// behind a read that will never settle.
export const CHAT_READ_MS = 8000

// One re-read of the bottom at a time, for its whole life. `step` returns
// true to run again at once (session changed, delta did not fit), up to `max`
// steps, still holding the lock: a polling tick or a return to the app during
// those steps starts nothing. `invalidate()` (another pane) lets a new load
// start at once; the step still in flight then sees `current()` turn false
// and drops its reply, even if it comes back after the new one.
export function createTailLoader(step: (current: () => boolean) => Promise<boolean>, max = 3) {
  let gen = 0
  let running: number | null = null
  async function load(): Promise<void> {
    if (running === gen) return
    const g = gen
    running = g
    const current = () => g === gen
    try {
      for (let k = 0; k < max && current(); k++) if (!await step(current)) break
    } finally { if (running === g) running = null }
  }
  return { load, invalidate: () => { gen++ } }
}
