import type { ChangeLine, ChangesResponse } from './types'

export interface ReviewLine extends ChangeLine { number: number | null, side: 'old' | 'new' }
export interface ReviewComment {
  id: string
  scope: 'working' | 'committed'
  path: string
  number: number
  side: 'old' | 'new'
  text: string
  body: string
}

// Headers never receive a number. Deleted lines advance only the old file.
export function reviewLines(lines: ChangeLine[]): ReviewLine[] {
  let old: number | null = null
  let next: number | null = null
  return lines.map(line => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line.text)
    if (line.kind === 'hunk') { old = hunk ? Number(hunk[1]) : null; next = hunk ? Number(hunk[2]) : null }
    const side = line.kind === 'del' ? 'old' : 'new'
    const number = ['add', 'del', 'context'].includes(line.kind) ? (side === 'old' ? old : next) : null
    if (line.kind === 'del' || line.kind === 'context') { if (old !== null) old++ }
    if (line.kind === 'add' || line.kind === 'context') { if (next !== null) next++ }
    return { ...line, number, side }
  })
}

export function matchesReview(comment: ReviewComment, line: ReviewLine) {
  return comment.number === line.number && comment.side === line.side && comment.text === line.text
}

// A hidden commit section is not a refreshed diff: its comments remain pending.
export function missingReviews(comments: ReviewComment[], changes: ChangesResponse, commitsRequested = false): ReviewComment[] {
  return comments.filter(c => {
    if (changes.git && c.scope === 'committed' && !changes.committed && !commitsRequested) return false
    const file = changes[c.scope]?.files.find(f => f.path === c.path)
    return !file || !reviewLines(file.lines).some(line => matchesReview(c, line))
  })
}

export function composeReview(comments: ReviewComment[], intro: string, oldLabel: string, missingLabel: string, missing: string[] = []) {
  const files = new Map<string, string[]>()
  for (const c of comments) {
    const body = c.body.trim().replace(/\s*\n\s*/g, ' ')
    if (!body) continue
    const notes = [c.side === 'old' ? oldLabel : '', missing.includes(c.id) ? missingLabel : ''].filter(Boolean)
    const line = `${c.path}:${c.number}${notes.length ? ` (${notes.join(', ')})` : ''} — ${body}`
    if (!files.has(c.path)) files.set(c.path, [])
    files.get(c.path)!.push(line)
  }
  return files.size ? `${intro}\n\n${[...files.values()].map(lines => lines.join('\n')).join('\n\n')}` : ''
}
