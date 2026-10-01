// A conversation already shown is not emptied on a single missed poll:
// remote transcript temporarily not found, agent missing from a
// snapshot, SSH read failing. We keep the last version and only
// conclude it has disappeared after several "unavailable" replies in a row.
export const CHAT_MISS_LIMIT = 3 // three polls in a row, a few seconds
// Beyond that, a small "reconnecting" note says the view is no longer up to date.
export const CHAT_STALE_AFTER = 2

export interface ChatMisses { misses: number, errors: number }

export const noMisses = (): ChatMisses => ({ misses: 0, errors: 0 })

// "Unavailable" reply: should the view be emptied now?
export function onUnavailable(s: ChatMisses, shown: boolean): { next: ChatMisses, clear: boolean } {
  if (!shown) return { next: noMisses(), clear: true }
  const misses = s.misses + 1
  if (misses >= CHAT_MISS_LIMIT) return { next: noMisses(), clear: true }
  return { next: { ...s, misses }, clear: false }
}

export const onError = (s: ChatMisses): ChatMisses => ({ ...s, errors: s.errors + 1 })

// View kept but no longer refreshed for a few polls.
export const isStale = (s: ChatMisses) => s.misses + s.errors >= CHAT_STALE_AFTER
