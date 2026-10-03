// Messages sent from wherdr with photos or files, remembered per pane for an
// hour. Claude Code's own queue and transcript only keep "[Image #1]" (or the
// image itself) for a photo, never the path wherdr typed: when wherdr's
// "queued" record of a message is gone (taken by the agent, expired, matched
// by mistake), this history still gives back its photo and file paths, so
// "Cancel" and "Stop" put the whole message back into wherdr's field.
import { isUploadLine, uploadNames, withoutUploads } from '../../shared/queuedMatch'
import { isAttachmentLine } from '../../shared/attachments'

export const SENT_TTL_MS = 60 * 60 * 1000
export const SENT_MAX = 30

export interface SentRecord { text: string, at: number }

// Photo or file lines: the parts Claude's own records lose.
export const hasAttachments = (text: string) => String(text || '').split('\n').some(l => isUploadLine(l) || isAttachmentLine(l))

// The history with `text` added (only a message with photos or files).
export function addSent(list: SentRecord[], text: string, now: number): SentRecord[] {
  const fresh = list.filter(r => now - r.at < SENT_TTL_MS)
  if (!hasAttachments(text)) return fresh
  return [...fresh, { text, at: now }].slice(-SENT_MAX)
}

const IMAGE_TAG = /\[Image #\d+(?:, \d+x\d+)?\]/g
const norm = (t: string) => String(t || '').replace(IMAGE_TAG, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

// The sent message (photo and file paths included) behind an entry of
// Claude's queue or a message of its transcript: same text and at least as
// many photos, the most recent first. A photos-only entry (no text) is
// matched by its number of photos. Never a message sent after the entry was
// written (`ts`, with a margin for clocks). `taken`: records already given to
// other entries. null: nothing known.
export function findSent(list: SentRecord[], entry: { text: string, images?: number, ts?: string | null }, now: number, taken: SentRecord[] = []): SentRecord | null {
  const images = entry.images || 0
  const want = norm(entry.text)
  const until = entry.ts ? Date.parse(entry.ts) + 5000 : NaN
  const cands = list.filter(r => now - r.at < SENT_TTL_MS && !taken.includes(r) && !(r.at > until)).reverse()
  if (!want) {
    if (!images) return null
    return cands.find(r => !withoutUploads(r.text) && uploadNames(r.text).length === images) || null
  }
  const enough = (r: SentRecord) => uploadNames(r.text).length >= images
  const text = (r: SentRecord) => norm(withoutUploads(r.text))
  // Exact text first, then one starting like the other (a long message
  // shortened by the screen, a reply marker…).
  return cands.find(r => enough(r) && text(r) === want)
    || cands.find(r => enough(r) && (text(r).startsWith(want.slice(0, 60)) || want.startsWith(text(r).slice(0, 60))) && Boolean(text(r)))
    || null
}

// Photos of an entry of Claude's queue that the text given back does not
// carry: lost (Claude keeps no copy of them).
export function lostPhotos(images: number | undefined, restored: string | null | undefined): number {
  return Math.max(0, (images || 0) - uploadNames(restored || '').length)
}
