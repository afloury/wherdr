// Messages the server gives back (QueuedMessage.back): held for an agent that
// will not come back (a Codex stopped by its update whose card was dismissed,
// or a Codex that simply left), in a pane that is a plain shell again, with no
// conversation to show them in. Their text returns to the pane's message
// field, after what is already typed there, so that the user never loses
// sight of something they wrote.
// The first device that sees a record takes it out of the server's queue
// (/api/unqueue): its text lands in one field only.
import type { HerdrState, QueuedMessage } from '../../shared/types'
import type { DraftAtt } from '../composables/useDraft'
import type { ReplyTarget } from '../../shared/replyQuote'
import { restoreDraft } from './queuedCancel'

export interface GivenBackDeps {
  // Takes the record out of the server's queue: its text, or a rejection
  // (another device took it, network).
  take: (paneId: string, q: QueuedMessage) => Promise<string>
  draft: (paneId: string) => { text: string, atts: DraftAtt[], reply?: ReplyTarget | null }
  // Texts just put back into the field of `paneId`.
  done?: (paneId: string, n: number) => void
}

export function createGivenBack(d: GivenBackDeps) {
  // Records being taken: a state may list them again before the answer.
  const taking = new Set<string>()
  // One pane at a time, in the order the messages were written.
  async function takePane(paneId: string, list: QueuedMessage[]) {
    let n = 0
    for (const q of list) {
      try {
        const text = await d.take(paneId, q)
        restoreDraft(d.draft(paneId), text || q.text, q.pasted, true)
        n++
      } catch { /* taken by another device, or retried on the next state */ }
      finally { taking.delete(`${paneId}\n${q.id}`) }
    }
    if (n) d.done?.(paneId, n)
  }
  return (state: Pick<HerdrState, 'panes'>): Promise<void[]> => Promise.all(state.panes.map((p) => {
    const list = (p.queued || []).filter(q => q.back && !taking.has(`${p.id}\n${q.id}`))
    for (const q of list) taking.add(`${p.id}\n${q.id}`)
    return list.length ? takePane(p.id, list) : undefined
  }))
}
