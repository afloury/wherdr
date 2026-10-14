// Input field drafts, one per conversation: the text and attached photos
// stay when switching conversations, and even after an
// app reload (localStorage). The photos are already stored on the
// server: we keep their path (sent with the message) and their name (preview
// via /uploads/<name>).

import { effectScope, reactive, nextTick } from 'vue'
import { watch } from '@vue/reactivity'
import { refLine } from '../../shared/reference'
import type { AttachKind } from '../../shared/attachments'

export interface DraftAtt {
  url: string // preview: local blob while the page lives, otherwise /uploads/<name> ('' for a file)
  path: string | null // null while the photo is being sent
  name?: string
  // Attached file (PDF, text…): shown as a chip; `ref` is what the message
  // carries (`@<path>` for Claude, the path otherwise).
  file?: { label: string, size: number, kind: AttachKind }
  ref?: string
  // Long pasted text (shared/pastedText.ts): a card; sent as it is, after the text.
  paste?: string
}
type StoredAtt = { path: string, name?: string, file?: DraftAtt['file'], ref?: string }

// A stored attachment back into the draft.
export function restoreAtt(a: StoredAtt): DraftAtt {
  return a.file
    ? { url: '', path: a.path, name: a.name, file: a.file, ref: a.ref || a.path }
    : { url: `/uploads/${encodeURIComponent(a.name!)}`, path: a.path, name: a.name }
}
interface Draft { text: string, atts: DraftAtt[] }

const KEY = 'draft:'
// Stored photos are purged after 7 days: we forget them before that.
const ATT_MAX_AGE = 6 * 86400000
const drafts = new Map<string, Draft>()
// Drafts outlive the component. Use the reactivity watcher below: Vue's
// component-aware watch captures the setup instance even in a detached scope.
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
      const d = JSON.parse(raw) as { text?: string, atts?: StoredAtt[], pastes?: string[], reply?: { time?: unknown, excerpt?: unknown } }
      // A draft saved while "Replying to the message" was a box above the
      // field: the message it named is now a reference in the text.
      const reply = d.reply && typeof d.reply.time === 'string' && typeof d.reply.excerpt === 'string'
        ? refLine({ kind: 'message', label: '', time: d.reply.time || null, n: null, id: null, excerpt: d.reply.excerpt.replace(/\s+/g, ' ').trim() })
        : ''
      return {
        text: [reply, d.text || ''].filter(Boolean).join('\n'),
        atts: (d.atts || [])
          .filter(a => a.path && a.name && Date.now() - uploadedAt(a.name) < ATT_MAX_AGE)
          .map(restoreAtt)
          .concat((d.pastes || []).filter(p => typeof p === 'string' && p).map(paste => ({ url: '', path: null, paste }))),
      }
    }
  } catch { /* stockage indisponible ou brouillon illisible */ }
  return { text: '', atts: [] }
}

function persist(paneId: string, d: Draft) {
  const atts = d.atts.filter(a => a.path && a.name).map(a => (a.file ? { path: a.path, name: a.name, file: a.file, ref: a.ref } : { path: a.path, name: a.name }))
  const pastes = d.atts.flatMap(a => (a.paste ? [a.paste] : []))
  try {
    if (!d.text && !atts.length && !pastes.length) localStorage.removeItem(KEY + paneId)
    else localStorage.setItem(KEY + paneId, JSON.stringify({ text: d.text, atts, pastes: pastes.length ? pastes : undefined }))
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
    let pending = false
    scope.run(() => watch(() => [draft.text, draft.atts.map(a => a.path || (a.paste ? `paste:${a.paste.length}` : '')).join('|')], () => persist(paneId, draft), {
      // Keep persistence batched and let setup/unmount draft restoration finish.
      scheduler(job) {
        if (pending) return
        pending = true
        nextTick(() => { pending = false; job() })
      },
    }))
  }
  return d
}
