import { describe, expect, it } from 'vitest'
import { clampBlock, composeReview, freshReviews, hunkRange, locateReview, missingReviews, reviewBlock, reviewExcerpt, reviewLines, reviewSpan, reviewText, sameBlock, spanLabel, type ReviewComment } from '../shared/review'
import type { ChangeLine, ChangesResponse } from '../shared/types'
const lines: ChangeLine[] = [
  { kind: 'meta', text: '+++ b/app.ts' },
  { kind: 'hunk', text: '@@ -8,2 +12,3 @@ section' },
  { kind: 'context', text: ' same' },
  { kind: 'del', text: '-old' },
  { kind: 'add', text: '+new' },
  { kind: 'add', text: '+extra' },
  { kind: 'meta', text: '\\ No newline at end of file' },
  { kind: 'hunk', text: '@@ -30 +40 @@' },
  { kind: 'add', text: '+last' },
]
const comment = (extra: Partial<ReviewComment> = {}): ReviewComment => ({ id: 'one', scope: 'working', path: 'app.ts', number: 13, side: 'new', text: '+new', body: 'Check this', ...extra })
const words = { intro: 'Review:', oldLine: 'old line', oldLines: 'old lines', missing: 'missing' }
const changes = (source = lines): ChangesResponse => ({ git: true, working: { count: 1, truncated: false, files: [{ path: 'app.ts', status: ' M', added: 3, deleted: 1, binary: false, truncated: false, lines: source }] } })
describe('inline review', () => {
  it('numbers new and old lines across hunks, excluding metadata', () => {
    expect(reviewLines(lines).map(l => [l.number, l.side])).toEqual([[null, 'new'], [null, 'new'], [12, 'new'], [9, 'old'], [13, 'new'], [14, 'new'], [null, 'new'], [null, 'new'], [40, 'new']])
    expect(reviewLines([{ kind: 'add', text: '+no hunk' }])[0]?.number).toBeNull()
  })
  it('groups files and labels deleted and missing lines, one remark and its excerpt per comment', () => {
    expect(composeReview([comment(), comment({ path: 'other.ts', number: 2 }), comment({ id: 'old', number: 9, side: 'old', text: '-old', body: 'Use\n another value' })], words, ['old']))
      .toBe('Review:\n\napp.ts:13 — Check this\n    +new\napp.ts:9 (old line, missing) — Use another value\n    -old\n\nother.ts:2 — Check this\n    +new')
    expect(composeReview([comment({ body: '  ' })], words)).toBe('')
  })
  it('writes a block as file:first-last, with the old lines it also covers', () => {
    const rows = reviewLines(lines)
    const block = (a: number, b: number) => comment({ ...reviewBlock(rows.slice(a, b + 1)) })
    expect(composeReview([block(4, 5)], words)).toBe('Review:\n\napp.ts:13-14 — Check this\n    +new\n    +extra')
    expect(composeReview([block(2, 5)], words)).toBe('Review:\n\napp.ts:12-14 (old line 9) — Check this\n     same\n    …\n    +extra')
    expect(composeReview([block(3, 3)], words)).toBe('Review:\n\napp.ts:9 (old line) — Check this\n    -old')
    const deleted = reviewLines([{ kind: 'hunk', text: '@@ -4,3 +0,0 @@' }, { kind: 'del', text: '-a()' }, { kind: 'del', text: '-' }, { kind: 'del', text: '-b()' }])
    expect(composeReview([comment({ ...reviewBlock(deleted.slice(1)) })], words)).toBe('Review:\n\napp.ts:4-6 (old lines) — Check this\n    -a()\n    -b()')
  })
  it('sends the text of an editor still open, and the saved text while an edit is empty', () => {
    expect(reviewText(comment({ body: '', draft: ' Typing ' }))).toBe('Typing')
    expect(reviewText(comment({ draft: '  ' }))).toBe('Check this')
    expect(composeReview([comment({ body: '', draft: 'Not saved yet' })], words)).toBe('Review:\n\napp.ts:13 — Not saved yet\n    +new')
  })
  it('keeps a block inside its hunk and on numbered lines', () => {
    const rows = reviewLines(lines)
    expect(hunkRange(rows, 4)).toEqual([2, 5])
    expect(hunkRange(rows, 8)).toEqual([8, 8])
    expect(clampBlock(rows, 4, 8)).toEqual([4, 5])
    expect(clampBlock(rows, 4, 0)).toEqual([2, 4])
    expect(clampBlock(rows, 3, 3)).toEqual([3, 3])
  })
  it('counts line numbers per side and labels them', () => {
    const rows = reviewLines(lines)
    const w = { line: 'Line', lines: 'Lines', oldLine: 'old line', oldLines: 'old lines' }
    expect(reviewSpan(rows.slice(2, 6))).toEqual({ new: [12, 14], old: [9, 9] })
    expect(spanLabel(reviewSpan(rows.slice(4, 6)), w)).toBe('Lines 13–14')
    expect(spanLabel(reviewSpan(rows.slice(4, 5)), w)).toBe('Line 13')
    expect(spanLabel(reviewSpan(rows.slice(3, 4)), w)).toBe('Line 9 (old line)')
    expect(spanLabel(reviewSpan(rows.slice(2, 6)), w)).toBe('Lines 12–14 + old line 9')
    expect(spanLabel({ old: [4, 6] }, w)).toBe('Lines 4–6 (old lines)')
  })
  it('shortens long excerpts and long lines', () => {
    const rows = reviewLines([{ kind: 'hunk', text: '@@ -0,0 +1,5 @@' }, ...['+one', '+', '+three', '+four', `+${'x'.repeat(200)}`].map(text => ({ kind: 'add' as const, text }))])
    const excerpt = reviewExcerpt(rows)
    expect(excerpt.slice(0, 2)).toEqual(['+one', '…'])
    expect(excerpt[2]).toHaveLength(100)
    expect(excerpt[2]!.endsWith('…')).toBe(true)
  })
  it('finds a block again by its first and last lines, in one hunk only', () => {
    const rows = reviewLines(lines)
    const block = comment({ ...reviewBlock(rows.slice(3, 6)) })
    expect(locateReview(block, rows)).toEqual([3, 5])
    expect(sameBlock(block, reviewBlock(rows.slice(3, 6)))).toBe(true)
    expect(sameBlock(block, reviewBlock(rows.slice(3, 5)))).toBe(false)
    expect(sameBlock(block, comment({ number: 9, side: 'old', text: '-old' }))).toBe(false)
    // A line added inside the block moves its numbers, not its ends.
    const grown = [...lines.slice(0, 5), { kind: 'add' as const, text: '+between' }, ...lines.slice(5)]
    expect(locateReview(block, reviewLines(grown))).toBeNull()
    expect(missingReviews([block], changes(grown))).toEqual([block])
    const across = comment({ end: { number: 40, side: 'new', text: '+last' } })
    expect(locateReview(across, rows)).toBeNull()
    expect(missingReviews([block], changes(lines.filter(l => l.text !== '+extra')))).toEqual([block])
  })
  it('refreshes the numbers and excerpt of a located block before sending', () => {
    const rows = reviewLines(lines)
    const stale = comment({ ...reviewBlock(rows.slice(4, 6)), excerpt: ['+stale'], span: { new: [1, 2] } })
    const [fresh] = freshReviews([stale, comment({ id: 'gone', path: 'gone.ts' })], changes())
    expect([fresh!.span, fresh!.excerpt]).toEqual([{ new: [13, 14] }, ['+new', '+extra']])
    expect(freshReviews([comment({ path: 'gone.ts', excerpt: ['+kept'] })], changes())[0]!.excerpt).toEqual(['+kept'])
  })
  it('flags removed files, changed text, moved numbers and sides without losing comments', () => {
    const c = comment()
    expect(missingReviews([c], changes())).toEqual([])
    expect(missingReviews([c], changes(lines.filter(l => l.text !== '+new')))).toEqual([c])
    expect(missingReviews([comment({ path: 'gone.ts' }), comment({ number: 14 }), comment({ side: 'old' })], changes())).toHaveLength(3)
    expect(c.body).toBe('Check this')
  })
  it('flags every comment when the folder is no longer a repository', () => {
    const comments = [comment(), comment({ scope: 'committed' })]
    expect(missingReviews(comments, { git: false })).toEqual(comments)
  })
  it('does not flag comments in a commit diff which has not been requested', () => {
    const c = comment({ scope: 'committed' })
    expect(missingReviews([c], changes())).toEqual([])
    expect(missingReviews([c], changes(), true)).toEqual([c])
  })
})
