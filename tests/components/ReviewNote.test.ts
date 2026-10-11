import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ReviewNote from '~/components/ReviewNote.vue'
import type { ReviewComment } from '#shared/review'

const saved: ReviewComment = { id: 'note', scope: 'working', path: 'src/app.ts', number: 12, side: 'new', text: '+a', body: 'Extract this' }
const mount = (comment: ReviewComment, missing = false) => mountSuspended(ReviewNote, { props: { comment, label: 'Lines 12–18', missing } })
const buttons = (w: Awaited<ReturnType<typeof mount>>) => w.findAll('button').map(b => b.text())

describe('ReviewNote', () => {
  it('shows a saved comment with its lines, Edit and a two-step Delete', async () => {
    const w = await mount(saved)
    expect(w.find('.review-range').text()).toBe('Lines 12–18')
    expect(w.find('.review-body').text()).toBe('Extract this')
    expect(w.find('textarea').exists()).toBe(false)
    expect(w.attributes('aria-label')).toBe('Lines 12–18: review comment')
    await w.findAll('button')[0]!.trigger('click')
    expect(w.emitted('act')).toEqual([['edit', 'note']])
    await w.findAll('button')[1]!.trigger('click')
    expect(buttons(w)).toEqual(['Edit', 'Confirm delete'])
    expect(w.emitted('act')).toHaveLength(1)
    await w.findAll('button')[1]!.trigger('click')
    expect(w.emitted('act')![1]).toEqual(['remove', 'note'])
  })

  it('saves with Cmd or Ctrl+Enter and reports each keystroke as the draft', async () => {
    const w = await mount({ ...saved, body: '', draft: '' })
    expect(buttons(w)).toEqual(['Cancel', 'Comment'])
    expect(w.findAll('button')[1]!.attributes('disabled')).toBeDefined()
    await w.find('textarea').trigger('keydown', { key: 'Enter', metaKey: true })
    expect(w.emitted('act')).toBeUndefined()
    await w.find('textarea').setValue('Split it')
    expect(w.emitted('act')).toEqual([['draft', 'note', 'Split it']])
    await w.setProps({ comment: { ...saved, body: '', draft: 'Split it' } })
    await w.find('textarea').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('act')).toHaveLength(1)
    await w.find('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await w.find('textarea').trigger('keydown', { key: 'Enter', metaKey: true })
    expect(w.emitted('act')!.slice(1)).toEqual([['save', 'note'], ['save', 'note']])
  })

  it('closes an untouched editor on Escape, and asks once before dropping written text', async () => {
    const w = await mount({ ...saved, draft: 'Extract this' })
    expect(buttons(w)).toEqual(['Cancel', 'Save'])
    await w.find('textarea').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('act')).toEqual([['cancel', 'note']])
    await w.setProps({ comment: { ...saved, draft: 'Extract this helper' } })
    await w.find('textarea').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('act')).toHaveLength(1)
    expect(buttons(w)).toEqual(['Discard this text?', 'Save'])
    await w.find('textarea').trigger('keydown', { key: 'Escape' })
    expect(w.emitted('act')![1]).toEqual(['cancel', 'note'])
  })

  it('keeps Escape for the editor from its buttons too, and for a pending Delete', async () => {
    const press = (el: Element) => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      el.dispatchEvent(e)
      return e.defaultPrevented
    }
    const w = await mountSuspended(ReviewNote, { props: { comment: { ...saved, draft: 'Unfinished edit' }, label: 'Line 12' }, attachTo: document.body })
    expect(press(w.findAll('button')[0]!.element)).toBe(true)
    await nextTick()
    expect(buttons(w)).toEqual(['Discard this text?', 'Save'])
    expect(w.emitted('act')).toBeUndefined()
    expect(press(w.findAll('button')[1]!.element)).toBe(true)
    expect(w.emitted('act')).toEqual([['cancel', 'note']])
    // A saved comment leaves Escape to the window, unless a Delete waits for its confirmation.
    await w.setProps({ comment: saved })
    expect(press(w.findAll('button')[0]!.element)).toBe(false)
    await w.findAll('button')[1]!.trigger('click')
    expect(press(w.findAll('button')[1]!.element)).toBe(true)
    await nextTick()
    expect(buttons(w)).toEqual(['Edit', 'Delete'])
    w.unmount()
  })

  it('names the file and warns when the block left the diff', async () => {
    const w = await mount(saved, true)
    expect(w.find('.review-path').text()).toBe('src/app.ts')
    expect(w.find('[role="status"]').text()).toContain('No longer in the diff')
    await w.setProps({ changed: true })
    expect(w.find('[role="status"]').text()).toContain('The code of this block changed')
  })
})
