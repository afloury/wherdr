// Spaces and tabs shared with herdr-app (and the other herdr-core clients) through
// each machine's "herdr-app" core document and the herdr.space / herdr.tab labels
// of a terminal. wherdr only reads the document; it never writes it. Anything
// unreadable falls back to the folder grouping.
export interface CoreDocTab { id: string; name?: string; root?: unknown }
export interface CoreDocSpace { id: string; name?: string; folder?: string; tabs?: CoreDocTab[] }
export interface CoreAppDoc { spaces?: CoreDocSpace[] }
// Document of each machine, by machine name ('' = this core).
export type CoreDocs = Record<string, CoreAppDoc | null | undefined>

export const SPACE_LABEL = 'herdr.space'
export const TAB_LABEL = 'herdr.tab'
export { SEEN_LABEL } from './coreInventory'
import { SEEN_LABEL } from './coreInventory'

// A document of unknown shape, reduced to what we read (anything else is dropped).
export function cleanDoc(raw: unknown): CoreAppDoc | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as CoreAppDoc).spaces)) return null
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const spaces: CoreDocSpace[] = []
  for (const s of (raw as { spaces: unknown[] }).spaces) {
    const o = s as Record<string, unknown> | null
    if (!o || typeof o.id !== 'string' || !o.id) continue
    const tabs: CoreDocTab[] = []
    if (Array.isArray(o.tabs)) for (const t of o.tabs) {
      const x = t as Record<string, unknown> | null
      if (x && typeof x.id === 'string' && x.id) tabs.push({ id: x.id, name: text(x.name), root: x.root })
    }
    spaces.push({ id: o.id, name: text(o.name), folder: text(o.folder), tabs })
  }
  return { spaces }
}

// Terminals a tab's layout tree points to (blocks hold `{ terminal: "t7" }`).
export function rootTerminals(root: unknown, out: string[] = [], depth = 0): string[] {
  if (!root || typeof root !== 'object' || depth > 40) return out
  for (const [k, v] of Object.entries(root)) {
    if (k === 'terminal' && typeof v === 'string') out.push(v)
    else if (v && typeof v === 'object') rootTerminals(v, out, depth + 1)
  }
  return out
}

const inside = (cwd: string, folder: string) => {
  const f = folder.replace(/\/+$/, '')
  return !!f && (cwd === f || cwd.startsWith(`${f}/`))
}

// Labels that put a new terminal in herdr-app: the space whose folder holds the
// cwd (the deepest one), else a new space; always a new tab. `existing` stands
// for a space of the document or a wherdr workspace made of one.
export function placementLabels(spaces: { id: string; folder?: string }[], cwd: string, newId: (prefix: string) => string, space?: string) {
  const best = space ?? spaces.filter(s => s.folder && inside(cwd, s.folder))
    .sort((a, b) => b.folder!.length - a.folder!.length)[0]?.id
  return { [SPACE_LABEL]: best ?? newId('sp'), [TAB_LABEL]: newId('tb'), [SEEN_LABEL]: '0' }
}
