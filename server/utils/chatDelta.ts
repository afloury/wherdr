// Incremental re-reads of a conversation's bottom (/api/chat).
//
// Each re-read of the bottom used to send every message from `from` to the
// end of the file again: about 400 KB for 2,000 messages, for one new line.
// Now the reply token ends with a fingerprint of the exact list sent
// (`#<hash>`), and the server remembers, per pane, the signature of each item
// of the last lists it sent. When a client comes back with such a token and
// the number of items it holds (`n`), the server sends only what follows the
// common prefix: `keep` (items to keep) and the items after them. Changed
// items (a tool that got its result, the reply being written) are inside
// that suffix, since the suffix starts at the first difference.
//
// Anything unknown (server restarted, list forgotten, other count, other
// start) gets the full list, exactly as before, and such a token never earns
// an "unchanged" reply (see knows): the delta is an optimisation, never a
// source of truth.
import { createHash } from 'node:crypto'
import type { ChatItem } from '../../shared/types'

const FP = /#([0-9a-f]{16})$/
const LISTS_PER_PANE = 4 // several devices on the same pane, a little history
const PANES = 64

export const itemSig = (it: ChatItem) => createHash('sha1').update(JSON.stringify(it)).digest('base64').slice(0, 16)
const listFp = (sigs: string[]) => createHash('sha1').update(sigs.join('\n')).digest('hex').slice(0, 16)

// Splits a client token into the transcript's own token and the fingerprint.
export function splitToken(token: string): { base: string, fp: string | null } {
  const m = FP.exec(token)
  return m ? { base: token.slice(0, m.index), fp: m[1]! } : { base: token, fp: null }
}

export function createChatDelta() {
  // pane -> token (with fingerprint) -> item signatures, oldest first.
  const panes = new Map<string, Map<string, string[]>>()

  function remember(pane: string, token: string, sigs: string[]) {
    let lists = panes.get(pane)
    if (lists) panes.delete(pane)
    else lists = new Map()
    panes.set(pane, lists) // most recently used last
    lists.delete(token)
    lists.set(token, sigs)
    while (lists.size > LISTS_PER_PANE) lists.delete(lists.keys().next().value!)
    while (panes.size > PANES) panes.delete(panes.keys().next().value!)
  }

  // `token`: the transcript's token for `items` (without fingerprint).
  // `since` / `n`: what the client says it holds (token as received, item count).
  // `sameStart`: the items start where the client's list starts.
  function reply(pane: string, token: string, items: ChatItem[], since: string, n: number | null, sameStart: boolean) {
    const sigs = items.map(itemSig)
    const full = `${token}#${listFp(sigs)}`
    // Only clients that splice (they send `n`) come back with this token.
    if (n === null) return { token: full, items }
    const old = sameStart && splitToken(since).fp ? panes.get(pane)?.get(since) : undefined
    remember(pane, full, sigs)
    if (!old || old.length !== n) return { token: full, items }
    let keep = 0
    const max = Math.min(old.length, sigs.length)
    while (keep < max && old[keep] === sigs[keep]) keep++
    return { token: full, items: items.slice(keep), keep }
  }

  // Whether the client's list is one the server sent and remembers, with
  // that many items. Otherwise its token must not earn an "unchanged" reply.
  const knows = (pane: string, since: string, n: number | null) =>
    n !== null && panes.get(pane)?.get(since)?.length === n

  // Transcript token to compare with the file (`since` of transcripts.chat):
  // '' for a fingerprinted token it does not know with that count.
  const sinceOf = (pane: string, sent: string, n: number | null) => {
    const t = splitToken(sent)
    return !t.fp || knows(pane, sent, n) ? t.base : ''
  }

  return { reply, knows, sinceOf, forget: (pane: string) => panes.delete(pane) }
}

export const chatDelta = createChatDelta()
