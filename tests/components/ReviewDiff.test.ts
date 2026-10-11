import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ReviewDiff from '~/components/ReviewDiff.vue'
import type { ChangeFile } from '#shared/types'
import type { ReviewComment, ReviewSelection } from '#shared/review'

const file: ChangeFile = { path: 'src/app.ts', status: ' M', added: 1, deleted: 1, binary: false, truncated: false, lines: [
  { kind: 'hunk', text: '@@ -7,2 +10,2 @@' }, { kind: 'context', text: ' keep' }, { kind: 'del', text: '-old' }, { kind: 'add', text: '+new' },
  { kind: 'hunk', text: '@@ -30 +40 @@' }, { kind: 'add', text: '+far' },
] }
const mount = (props: { comments?: ReviewComment[], selection?: ReviewSelection | null } = {}) => mountSuspended(ReviewDiff, { props: { file, scope: 'working' as const, comments: [], ...props }, attachTo: document.body })
const last = <T>(list: T[] | undefined) => list!.at(-1)!
const down = (init: Partial<PointerEventInit> = {}) => new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, bubbles: true, cancelable: true, ...init })

describe('ReviewDiff', () => {
  it('renders one row per diff line, with the line number alone as gutter text', async () => {
    const w = await mount()
    const rows = w.findAll('.change-line')
    expect(rows.map(r => r.find('.review-source').text())).toEqual(['@@ -7,2 +10,2 @@', 'keep', '-old', '+new', '@@ -30 +40 @@', '+far'])
    expect(rows[0]!.find('.review-gutter').exists()).toBe(false)
    // The "+" of the gutter is the comment marker, kept out of the number's flow.
    const gutters = rows.slice(1, 4).map(r => r.find('.review-gutter'))
    expect(gutters.map(g => g.find('.review-number').text())).toEqual(['10', '8', '11'])
    for (const g of gutters) {
      expect(g.find('.review-plus').attributes('aria-hidden')).toBe('true')
      expect(g.element.children).toHaveLength(2)
    }
    expect(gutters[1]!.attributes('aria-label')).toBe('Comment on line 8 (old line)')
    // One tab stop for the whole diff.
    expect(w.findAll('.review-gutter').map(g => g.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1'])
    w.unmount()
  })

  it('does nothing on a click in the code', async () => {
    const w = await mount()
    await w.findAll('.review-source')[3]!.trigger('click', { detail: 1 })
    await w.findAll('.change-line')[3]!.trigger('click', { detail: 1 })
    expect(w.emitted('add')).toBeUndefined()
    expect(w.emitted('select')).toBeUndefined()
    w.unmount()
  })

  it('comments one line from the keyboard, and a block chosen with Shift+Arrow', async () => {
    const w = await mount()
    const gutters = w.findAll('.review-gutter')
    await gutters[2]!.trigger('click')
    expect(last(w.emitted('add'))).toEqual(['working', 'src/app.ts', [{ kind: 'add', text: '+new', number: 11, side: 'new' }], undefined])
    await gutters[0]!.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
    const picked = last(w.emitted('select'))[0] as ReviewSelection
    expect([picked.anchor, picked.head, picked.via, picked.block.map(l => l.number)]).toEqual([1, 2, 'keys', [10, 8]])
    expect(document.activeElement).toBe(gutters[1]!.element)
    await w.setProps({ selection: picked })
    expect(w.findAll('.review-line.picked')).toHaveLength(2)
    expect(w.findAll('.review-line.out')).toHaveLength(2)
    // The block stops at the end of its hunk.
    await gutters[1]!.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
    await w.setProps({ selection: last(w.emitted('select'))[0] as ReviewSelection })
    await gutters[2]!.trigger('keydown', { key: 'ArrowDown', shiftKey: true })
    expect((last(w.emitted('select'))[0] as ReviewSelection).head).toBe(3)
    await gutters[2]!.trigger('click')
    expect((last(w.emitted('add'))[2] as { number: number }[]).map(l => l.number)).toEqual([10, 8, 11])
    expect(last(w.emitted('select'))).toEqual([null])
    w.unmount()
  })

  it('moves between lines with the arrows, across hunks, and lets go of a block on Escape', async () => {
    const w = await mount()
    const gutters = w.findAll('.review-gutter')
    await gutters[2]!.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(gutters[3]!.element)
    await gutters[3]!.trigger('keydown', { key: 'ArrowUp', shiftKey: true })
    // Alone in its hunk: the block cannot grow.
    expect((last(w.emitted('select'))[0] as ReviewSelection).head).toBe(5)
    await w.setProps({ selection: last(w.emitted('select'))[0] as ReviewSelection })
    await gutters[3]!.trigger('keydown', { key: 'Escape' })
    expect(last(w.emitted('select'))).toEqual([null])
    w.unmount()
  })

  it('opens the editor on mouse release, on the lines dragged over within the hunk', async () => {
    const w = await mount()
    const gutters = w.findAll('.review-gutter')
    gutters[0]!.element.dispatchEvent(down())
    const picked = last(w.emitted('select'))[0] as ReviewSelection
    expect([picked.anchor, picked.head, picked.via]).toEqual([1, 1, 'drag'])
    await w.setProps({ selection: picked })
    expect(w.find('.change-code').classes()).toContain('dragging')
    window.dispatchEvent(new PointerEvent('pointerup'))
    expect(last(w.emitted('add'))).toEqual(['working', 'src/app.ts', [{ kind: 'context', text: ' keep', number: 10, side: 'new' }], undefined])
    // The click that follows the release adds nothing.
    await gutters[0]!.trigger('click', { detail: 1 })
    expect(w.emitted('add')).toHaveLength(1)
    w.unmount()
  })

  it('extends the block of the open editor on Shift+click', async () => {
    const open: ReviewComment = { id: 'open', scope: 'working', path: 'src/app.ts', number: 10, side: 'new', text: ' keep', body: '', draft: '' }
    const w = await mount({ comments: [open] })
    w.findAll('.review-gutter')[2]!.element.dispatchEvent(down({ shiftKey: true }))
    const picked = last(w.emitted('select'))[0] as ReviewSelection
    expect([picked.anchor, picked.head]).toEqual([1, 3])
    await w.setProps({ selection: picked })
    window.dispatchEvent(new PointerEvent('pointerup'))
    expect(last(w.emitted('add'))[3]).toBe('open')
    expect((last(w.emitted('add'))[2] as unknown[])).toHaveLength(3)
    w.unmount()
  })

  it('chooses a line on a tap, the other end on the next tap, and starts over in another hunk', async () => {
    const w = await mount()
    const gutters = w.findAll('.review-gutter')
    const tap = async (el: Element) => {
      el.dispatchEvent(down({ pointerType: 'touch' }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      const s = last(w.emitted('select'))[0] as ReviewSelection | null
      await w.setProps({ selection: s })
      return s
    }
    expect((await tap(gutters[1]!.element))!.via).toBe('touch')
    expect(w.emitted('add')).toBeUndefined()
    // Once a block is being chosen, the whole row extends it.
    const grown = await tap(w.findAll('.review-source')[3]!.element)
    expect([grown!.anchor, grown!.head, grown!.block.map(l => l.number)]).toEqual([2, 3, [8, 11]])
    expect((await tap(gutters[3]!.element))!.anchor).toBe(5)
    expect(await tap(gutters[3]!.element)).toBeNull()
    w.unmount()
  })

  it('shows a comment under the last line of its block and marks the lines it covers', async () => {
    const saved: ReviewComment = { id: 'saved', scope: 'working', path: 'src/app.ts', number: 8, side: 'old', text: '-old', end: { number: 11, side: 'new', text: '+new' }, body: 'Why this change?' }
    const w = await mount({ comments: [saved, { ...saved, id: 'other', path: 'src/other.ts' }] })
    expect(w.findAll('.review-note')).toHaveLength(1)
    expect(w.find('.review-range').text()).toBe('Line 11 + old line 8')
    expect(w.find('.review-note').element.previousElementSibling).toBe(w.findAll('.change-line')[3]!.element)
    expect(w.findAll('.review-line.noted')).toHaveLength(2)
    await w.setProps({ comments: [{ ...saved, draft: 'Why this change?' }] })
    expect(w.findAll('.review-line.open')).toHaveLength(2)
    expect(w.findAll('.review-line.noted')).toHaveLength(0)
    w.unmount()
  })
})
