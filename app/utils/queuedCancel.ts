// "Cancel" button of queued messages: when to show it, and how to
// put the message back into the input field (text + attached photos).
import type { Pane } from '../../shared/types'
import type { DraftAtt } from '../composables/useDraft'
import { parseReply, type ReplyTarget } from '../../shared/replyQuote'

const UPLOAD = '/.cache/herdr-web/uploads/'

// Not sent yet (agent starting): always. Otherwise only for a working
// Claude: its queue is recalled with ↑; Codex's has no verified
// recall. When not working, the message is already read (or about to be).
export function canCancelQueued(p: Pane | undefined): boolean {
  if (!p || !p.agent) return false
  return Boolean(p.pendingPrompt) || (p.agent === 'claude' && p.status === 'working')
}

// Puts a cancelled message back into the draft, as if it had never been
// sent: its text before what was already typed, its attached photos.
export function restoreDraft(draft: { text: string, atts: DraftAtt[], reply?: ReplyTarget | null }, message: string) {
  // Reply to a specific message: the marker becomes the "Replying to" box again.
  const parsed = parseReply(message)
  if (parsed && 'reply' in draft) {
    draft.reply = parsed.reply
    message = parsed.body
  }
  const lines = String(message || '').split('\n')
  const photos = lines.filter(l => l.includes(UPLOAD)).map(l => l.trim())
  const text = lines.filter(l => !l.includes(UPLOAD)).join('\n').trim()
  draft.text = [text, draft.text.trim()].filter(Boolean).join('\n')
  for (const path of photos) {
    if (draft.atts.some(a => a.path === path)) continue
    const name = path.split('/').pop()!
    draft.atts.push({ url: `/uploads/${encodeURIComponent(name)}`, path, name })
  }
}
