import type { ChatItem } from './types'

// Images a tool returned that are the same image (same bytes) as one shown
// higher up in the conversation: a user's photo the agent reads back, or a
// file read twice. Keyed `<ref>:<index on its line>` (the `ref`/`i` of
// /api/chat/image). User messages always show their images.
export function duplicateImages(items: readonly ChatItem[]): Set<string> {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const it of items) {
    if (!it.hashes || !it.ref) continue
    it.hashes.forEach((h, k) => {
      if (it.role !== 'user' && seen.has(h)) dupes.add(`${it.ref}:${(it.imageAt || 0) + k}`)
      seen.add(h)
    })
  }
  return dupes
}
