import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { useDraft } from '~/composables/useDraft'

function view(id: string) {
  let draft!: ReturnType<typeof useDraft>
  const wrapper = mount(defineComponent({ setup() { draft = useDraft(id); return () => h('div', draft.text) } }))
  return { wrapper, draft }
}
// Persistence is batched with Vue's pending updates and must finish before reload.
async function saved() { await nextTick(); await nextTick() }

describe('persistent conversation drafts', () => {
  it('batches text changes and keeps the same draft across unmounts and panes', async () => {
    const id = 'draft-lifetime'
    const first = view(id)
    first.draft.text = 'First edit'
    first.draft.text = 'Last edit'
    expect(localStorage.getItem(`draft:${id}`)).toBeNull()
    await saved()
    expect(JSON.parse(localStorage.getItem(`draft:${id}`)!).text).toBe('Last edit')
    first.wrapper.unmount()
    first.draft.text = 'Edited after leaving'
    await saved()
    const other = view('draft-other-pane')
    const second = view(id)
    expect(second.draft).toBe(first.draft)
    expect(second.draft.text).toBe('Edited after leaving')
    expect(other.draft.text).toBe('')
    second.draft.text = ''
    await saved()
    expect(localStorage.getItem(`draft:${id}`)).toBeNull()
    second.wrapper.unmount(); other.wrapper.unmount()
  })

  it('persists completed uploads and pastes after the originating view unmounts', async () => {
    const id = 'draft-upload-lifetime'
    const { wrapper, draft } = view(id)
    draft.text = 'Keep the files'
    draft.atts.push({ url: 'blob:synthetic', path: null })
    wrapper.unmount()
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-fixture.png`
    Object.assign(draft.atts[0]!, { path: '/tmp/fixture.png', name })
    draft.atts.push({ url: '', path: '/tmp/fixture.txt', name, file: { label: 'fixture.txt', size: 12, kind: 'text' }, ref: '@/tmp/fixture.txt' })
    draft.atts.push({ url: '', path: null, paste: 'Pasted fixture\nSecond line' })
    await saved()
    expect(JSON.parse(localStorage.getItem(`draft:${id}`)!)).toEqual({
      text: 'Keep the files',
      atts: [{ path: '/tmp/fixture.png', name }, { path: '/tmp/fixture.txt', name, file: { label: 'fixture.txt', size: 12, kind: 'text' }, ref: '@/tmp/fixture.txt' }],
      pastes: ['Pasted fixture\nSecond line'],
    })
    draft.atts.splice(0); draft.text = ''
    await saved()
    expect(localStorage.getItem(`draft:${id}`)).toBeNull()
  })

  it('restores stored text, photo and file references, and pasted text on first access', () => {
    const id = 'draft-stored-fixture'
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-fixture.png`
    localStorage.setItem(`draft:${id}`, JSON.stringify({ text: 'Saved text', atts: [
      { path: '/tmp/fixture.png', name },
      { path: '/tmp/fixture.txt', name, file: { label: 'fixture.txt', size: 12, kind: 'text' }, ref: '@/tmp/fixture.txt' },
    ], pastes: ['Saved paste'] }))
    const { wrapper, draft } = view(id)
    expect(draft.text).toBe('Saved text')
    expect(draft.atts).toEqual([
      { url: `/uploads/${name}`, path: '/tmp/fixture.png', name },
      { url: '', path: '/tmp/fixture.txt', name, file: { label: 'fixture.txt', size: 12, kind: 'text' }, ref: '@/tmp/fixture.txt' },
      { url: '', path: null, paste: 'Saved paste' },
    ])
    wrapper.unmount(); localStorage.removeItem(`draft:${id}`)
  })
})
