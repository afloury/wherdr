import { effectScope } from 'vue'
import { describe, expect, it } from 'vitest'
import { useReviewDraft } from '~/composables/useReviewDraft'
import type { ReviewComment } from '#shared/review'

const comment: ReviewComment = { id: 'note', scope: 'working', path: 'src/app.ts', number: 5, side: 'new', text: '+value', body: 'Check this value' }
const block: ReviewComment = { ...comment, id: 'block', end: { number: 8, side: 'new', text: '+end' }, span: { new: [5, 8] }, excerpt: ['+value', '…', '+end'], body: '', draft: 'Half written' }
describe('local review drafts', () => {
  it('persists edits synchronously and restores them after the view unmounts', () => {
    localStorage.removeItem('review:review-test')
    const scope = effectScope()
    const comments = scope.run(() => useReviewDraft('review-test'))!
    comments.value.push({ ...comment })
    comments.value[0]!.body = 'Updated comment'
    scope.stop()
    const next = effectScope()
    const restored = next.run(() => useReviewDraft('review-test'))!
    expect(restored.value).toEqual([{ ...comment, body: 'Updated comment' }])
    restored.value = []
    expect(localStorage.getItem('review:review-test')).toBeNull()
    next.stop()
  })
  it('restores a block and the text of an editor left open, not an empty editor', () => {
    localStorage.removeItem('review:review-test')
    const scope = effectScope()
    const comments = scope.run(() => useReviewDraft('review-test'))!
    comments.value.push({ ...block }, { ...comment, id: 'empty', body: '', draft: '  ' })
    comments.value[0]!.draft = 'Half written, then more'
    scope.stop()
    const next = effectScope()
    expect(next.run(() => useReviewDraft('review-test'))!.value).toEqual([{ ...block, draft: 'Half written, then more' }])
    next.stop()
    localStorage.removeItem('review:review-test')
  })
  it('isolates agents and ignores malformed stored entries', () => {
    const bad = [{ id: 'invalid' }, { ...comment, end: { number: 0, side: 'new', text: '' } }, { ...comment, span: {} }, { ...comment, span: { new: [1] } }, { ...comment, excerpt: [1] }, { ...comment, draft: 3 }]
    localStorage.setItem('review:review-test-one', JSON.stringify([comment, ...bad]))
    localStorage.setItem('review:review-test-two', 'invalid json')
    const scope = effectScope()
    scope.run(() => {
      expect(useReviewDraft('review-test-one').value).toEqual([comment])
      expect(useReviewDraft('review-test-two').value).toEqual([])
    })
    scope.stop()
    localStorage.removeItem('review:review-test-one')
    localStorage.removeItem('review:review-test-two')
  })
})
