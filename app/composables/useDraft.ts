// Input field drafts, one per conversation: the text and attached photos
// stay when switching conversations, and even after an
// app reload (localStorage). The photos are already stored on the
// server: we keep their path (sent with the message) and their name (preview
// via /uploads/<name>).

import { effectScope, reactive, watch } from 'vue'
import type { ReplyTarget } from '../../shared/replyQuote'

export interface DraftAtt {
  url: string // preview: local blob while the page lives, otherwise /uploads/<name>
  path: string | null // null while the photo is being sent
  name?: string
}
// reply: the agent message being replied to (see utils/replyQuote.ts).
interface Draft { text: string, atts: DraftAtt[], reply: ReplyTarget | null }

const KEY = 'draft:'
// Stored photos are purged after 7 days: we forget them before that.
const ATT_MAX_AGE = 6 * 86400000
const drafts = new Map<string, Draft>()
// Drafts outlive the component: their watchers do not belong to it.
const scope = effectScope(true)

// Upload date of a photo, read from its name (2026-09-26T00-36-39-393Z-4fa305.jpg).
export function uploadedAt(name: string) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(name)
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : 0
}

function load(paneId: string): Draft {
  try {
    const raw = localStorage.getItem(KEY + paneId)
    if (raw) {
      const d = JSON.parse(raw) as { text?: string, atts?: { path: string, name?: string }[], reply?: ReplyTarget }
      return {
        text: d.text || '',
        atts: (d.atts || [])
          .filter(a => a.path && a.name && Date.now() - uploadedAt(a.name) < ATT_MAX_AGE)
          .map(a => ({ url: `/uploads/${encodeURIComponent(a.name!)}`, path: a.path, name: a.name })),
        reply: d.reply && typeof d.reply.time === 'string' && typeof d.reply.excerpt === 'string' ? { time: d.reply.time, excerpt: d.reply.excerpt, ...(d.reply.part ? { part: true } : {}) } : null,
      }
    }
  } catch { /* stockage indisponible ou brouillon illisible */ }
  return { text: '', atts: [], reply: null }
}

function persist(paneId: string, d: Draft) {
  const atts = d.atts.filter(a => a.path && a.name).map(a => ({ path: a.path, name: a.name }))
  try {
    if (!d.text && !atts.length && !d.reply) localStorage.removeItem(KEY + paneId)
    else localStorage.setItem(KEY + paneId, JSON.stringify({ text: d.text, atts, reply: d.reply || undefined }))
  } catch { /* stockage indisponible */ }
}

// Reactive draft of the pane: the same object while the page lives, so a
// photo that finishes uploading after a conversation switch lands there.
export function useDraft(paneId: string): Draft {
  let d = drafts.get(paneId)
  if (!d) {
    d = reactive(load(paneId)) as Draft
    drafts.set(paneId, d)
    const draft = d
    scope.run(() => watch(() => [draft.text, draft.atts.map(a => a.path).join('|'), draft.reply?.excerpt, draft.reply?.time, draft.reply?.part], () => persist(paneId, draft)))
  }
  return d
}
