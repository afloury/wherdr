import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ReviewDiff from '~/components/ReviewDiff.vue'
import type { ChangeFile } from '#shared/types'

const file: ChangeFile = { path: 'src/app.ts', status: ' M', added: 1, deleted: 1, binary: false, truncated: false, lines: [
  { kind: 'hunk', text: '@@ -7,2 +10,2 @@' }, { kind: 'context', text: ' keep' }, { kind: 'del', text: '-old' }, { kind: 'add', text: '+new' },
] }

describe('ReviewDiff', () => {
  it('renders one row per diff line, with the line number alone as gutter text', async () => {
    const w = await mountSuspended(ReviewDiff, { props: { file, scope: 'working', comments: [] } })
    const rows = w.findAll('.change-line')
    expect(rows.map(r => r.find('.review-source').text())).toEqual(['@@ -7,2 +10,2 @@', 'keep', '-old', '+new'])
    expect(rows[0]!.find('.review-gutter').exists()).toBe(false)
    // The "+" of the gutter is the comment marker, kept out of the number's flow.
    const gutters = rows.slice(1).map(r => r.find('.review-gutter'))
    expect(gutters.map(g => g.find('.review-number').text())).toEqual(['10', '8', '11'])
    for (const g of gutters) {
      expect(g.find('.review-plus').attributes('aria-hidden')).toBe('true')
      expect(g.element.children).toHaveLength(2)
    }
    expect(gutters[1]!.attributes('aria-label')).toBe('Comment on line 8 (old line)')
  })

  it('asks for a comment from the gutter of a line', async () => {
    const w = await mountSuspended(ReviewDiff, { props: { file, scope: 'working', comments: [] } })
    await w.findAll('.review-gutter')[2]!.trigger('click')
    expect(w.emitted('add')).toEqual([['working', 'src/app.ts', { kind: 'add', text: '+new', number: 11, side: 'new' }]])
  })
})
