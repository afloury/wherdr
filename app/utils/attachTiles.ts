// The props of one attachment's tile (AttachTile), shared by the message
// field and sent messages so both look the same: a photo, a file, pasted text.
import { attachmentDisplayName, attachmentIcon, extensionOf, formatSize, type AttachKind } from '#shared/attachments'
import { lineCount, looksLikeLog } from '#shared/pastedText'

// A text's first lines, as the tile's preview.
export const firstLines = (s: string) => s.split('\n').slice(0, 10).map(l => l.slice(0, 80)).join('\n')
const badgeOf = (name: string, fallback: string) => extensionOf(name).slice(0, 5).toUpperCase() || fallback

export function pasteTile(text: string) {
  const n = lineCount(text)
  return { name: t('Pasted text'), badge: looksLikeLog(text) ? 'LOG' : 'TXT', description: `${n} line${n > 1 ? 's' : ''}`, text: firstLines(text), label: tl('Open pasted text', 'Ouvrir le texte collé') }
}

export function fileTile(name: string, kind?: AttachKind, size?: number, head?: string) {
  return { name, badge: badgeOf(name, kind === 'text' ? 'TXT' : 'FILE'), description: size ? formatSize(size) : undefined, text: head, icon: attachmentIcon(name, kind) }
}

// A photo's name: the one given, else the file name of an upload's URL, else "Photo".
export function photoTile(src: string, name?: string) {
  let base = name || ''
  if (!base) {
    try { base = attachmentDisplayName(decodeURIComponent(new URL(src, 'http://local').pathname)) } catch { /* not a URL */ }
    if (!extensionOf(base)) base = ''
  }
  // A photo stored without its own name (herdr-core) is just "Photo".
  const own = base.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}(?=\.\w+$)/, '')
  return { name: own.startsWith('.') || !own ? t('Photo') : own, badge: badgeOf(base, 'IMG'), label: t('View image') }
}
