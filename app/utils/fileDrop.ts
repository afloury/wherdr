// Drag and drop of files (Finder, file explorer): the browser would open
// the file instead of the app. We only deal with drags that carry
// files; text dragged into the field keeps its normal behaviour.
import { ATTACH_LIMITS, SNIFF_BYTES, checkAttachment, formatSize, type AttachKind, type RefuseReason } from '../../shared/attachments'
import { tl } from './i18n'

export function carriesFiles(dt: { types?: ArrayLike<string> | null } | null | undefined): boolean {
  return Boolean(dt && dt.types && Array.from(dt.types).includes('Files'))
}

// Files given to the message field (drop, +, paste): images take the photo
// path (shrunk), files the agent can read are attached, the rest is refused
// with the reason (see shared/attachments.ts).
export type Sorted<F> = { images: F[], files: { file: F, kind: AttachKind }[], refused: { file: F, reason: RefuseReason, kind?: AttachKind }[] }
export async function sortForAgent<F extends Blob & { name: string }>(files: F[], agent: string | null | undefined): Promise<Sorted<F>> {
  const out: Sorted<F> = { images: [], files: [], refused: [] }
  for (const f of files) {
    const head = new Uint8Array(await f.slice(0, SNIFF_BYTES).arrayBuffer())
    const c = checkAttachment(agent, { name: f.name, type: f.type, size: f.size }, head)
    if (!c.ok) out.refused.push({ file: f, reason: c.reason, kind: c.kind })
    else if (c.kind === 'image') out.images.push(f)
    else out.files.push({ file: f, kind: c.kind })
  }
  return out
}

// Why a file is refused, for the agent named `who` ("Claude Code"…).
export function refusalText(reason: RefuseReason, who: string, kind?: AttachKind): string {
  switch (reason) {
    case 'archive': return tl(`${who} can’t read archives — extract the files first`, `${who} ne lit pas les archives — décompresse d’abord`)
    case 'video': return tl(`${who} can’t read videos`, `${who} ne lit pas les vidéos`)
    case 'audio': return tl(`${who} can’t read audio files`, `${who} ne lit pas les fichiers audio`)
    case 'office': return tl(`${who} can’t read Office documents — export to PDF or text`, `${who} ne lit pas les documents Office — exporte en PDF ou en texte`)
    case 'executable': return tl(`${who} can’t read programs`, `${who} ne lit pas les programmes`)
    case 'pdf': return tl(`${who} can’t read PDFs (Claude Code can)`, `${who} ne lit pas les PDF (Claude Code oui)`)
    case 'too_large': {
      const max = formatSize(ATTACH_LIMITS[kind || 'text'])
      return tl(`too large (${max} max)`, `trop gros (${max} max)`)
    }
    case 'empty': return tl('empty file', 'fichier vide')
    default: return tl(`${who} can’t read this binary file`, `${who} ne lit pas ce fichier binaire`)
  }
}

// Enter/leave counter: `dragleave` fires for each child hovered.
export function dragDepth(depth: number, type: string): number {
  if (type === 'dragenter') return depth + 1
  if (type === 'dragleave') return Math.max(0, depth - 1)
  if (type === 'drop') return 0
  return depth
}
