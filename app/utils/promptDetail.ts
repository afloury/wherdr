// Permission request: one-line summary for the cards (home, plan),
// and splitting of the diff for the agent view.
import type { PromptDetail } from '#shared/types'

export function detailStats(d: PromptDetail): string {
  return [d.added ? `+${d.added}` : '', d.removed ? `−${d.removed}` : ''].filter(Boolean).join(' ')
}

// "$ npm test", "app/foo.ts +3 −1", or the tool name.
export function detailLine(d: PromptDetail | null | undefined): string {
  if (!d) return ''
  // The file name matters more than its folder (the card cuts on the right).
  if (d.file) return [d.file.split(', ').map(f => f.split('/').pop()).join(', '), detailStats(d)].filter(Boolean).join('  ')
  // Lines continued with "\": a single line.
  const first = (d.command || '').replace(/\s*\\\n\s*/g, ' ').split('\n').find(l => l.trim())
  if (first) return `$ ${first.trim()}`
  return d.description || d.tool
}

export type DetailLineKind = 'add' | 'del' | null
// Line of a diff ("+ x", "12 + x", "- y"): addition, removal or context.
export function diffKind(line: string, isFile: boolean): DetailLineKind {
  if (!isFile) return null
  if (/^(?:\s*\d+\s*)?\+/.test(line) && !/^\+\+\+/.test(line)) return 'add'
  if (/^(?:\s*\d+\s*)?-/.test(line) && !/^---/.test(line)) return 'del'
  return null
}
