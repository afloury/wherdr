import { describe, expect, it } from 'vitest'
import { composeReview, missingReviews, reviewLines, type ReviewComment } from '../shared/review'
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
const changes = (source = lines): ChangesResponse => ({ git: true, working: { count: 1, truncated: false, files: [{ path: 'app.ts', status: ' M', added: 3, deleted: 1, binary: false, truncated: false, lines: source }] } })
describe('inline review', () => {
  it('numbers new and old lines across hunks, excluding metadata', () => {
    expect(reviewLines(lines).map(l => [l.number, l.side])).toEqual([[null, 'new'], [null, 'new'], [12, 'new'], [9, 'old'], [13, 'new'], [14, 'new'], [null, 'new'], [null, 'new'], [40, 'new']])
    expect(reviewLines([{ kind: 'add', text: '+no hunk' }])[0]?.number).toBeNull()
  })
  it('groups files and labels deleted and missing lines, keeping one remark per line', () => {
    expect(composeReview([comment(), comment({ path: 'other.ts', number: 2 }), comment({ id: 'old', number: 9, side: 'old', body: 'Use\n another value' })], 'Review:', 'old line', 'missing', ['old'])).toBe('Review:\n\napp.ts:13 — Check this\napp.ts:9 (old line, missing) — Use another value\n\nother.ts:2 — Check this')
    expect(composeReview([comment({ body: '  ' })], 'Review:', 'old', 'missing')).toBe('')
  })
  it('flags removed files, changed text, moved numbers and sides without losing comments', () => {
    const c = comment()
    expect(missingReviews([c], changes())).toEqual([])
    expect(missingReviews([c], changes(lines.filter(l => l.text !== '+new')))).toEqual([c])
    expect(missingReviews([comment({ path: 'gone.ts' }), comment({ number: 14 }), comment({ side: 'old' })], changes())).toHaveLength(3)
    expect(c.body).toBe('Check this')
  })
  it('does not flag comments in a commit diff which has not been requested', () => {
    expect(missingReviews([comment({ scope: 'committed' })], changes())).toEqual([])
  })
})
