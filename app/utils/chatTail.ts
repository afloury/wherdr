import type { ChatItem, ChatResponse } from '#shared/types'

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
