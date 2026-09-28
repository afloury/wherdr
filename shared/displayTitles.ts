import type { Pane, Workspace } from './types'
import { cleanTitle, paneTitle } from './paneTitle'

// herdr-projects marks its spaces with invisible characters (braille blank
// U+2800, zero-width spaces); some fonts draw them as dot grids.
export function cleanLabel(label: string | null | undefined): string {
  return (label ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[\u2800\s]+/g, ' ').trim()
}

// Herdr's workspace label is the visible identity of a space. A pane title is
// still useful context, but only when it carries more information.
export function spaceTitle(p: Pane, workspace?: Workspace | null): string {
  return workspace?.label?.trim() || paneTitle(p)
}

export function conversationSubtitle(p: Pane, workspace?: Workspace | null): string {
  const title = cleanTitle(p.title).replace(/\s*\|\s*\S+$/, '').trim()
  if (!title || /^\S+@\S+:/.test(title)) return ''
  const generic = [p.agent, p.name, 'Claude Code', 'Claude', 'Codex', 'Gemini CLI', 'OpenCode', 'Kimi']
  if (generic.some(x => x && x.trim().toLocaleLowerCase() === title.toLocaleLowerCase())) return ''
  if (title.toLocaleLowerCase() === spaceTitle(p, workspace).toLocaleLowerCase()) return ''
  return title
}
