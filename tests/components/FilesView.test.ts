import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import FilesView from '~/components/FilesView.vue'

const asked: string[] = []
registerEndpoint('/api/files', (event) => {
  const path = String(getQuery(event).path ?? '')
  asked.push(path)
  return path === 'src'
    ? { root: '/home/user/demo', path: 'src', truncated: false, entries: [{ name: 'app.ts', kind: 'file', size: 19, link: false }] }
    : { root: '/home/user/demo', path: '', truncated: false, entries: [
        { name: 'src', kind: 'dir', size: null, link: false },
        { name: '.env', kind: 'file', size: 4, link: false },
        { name: 'README.md', kind: 'file', size: 8, link: false },
      ] }
})
let hold: Promise<void> | null = null
registerEndpoint('/api/files/read', async (event) => {
  if (hold) await hold
  return { path: String(getQuery(event).path), size: 19, kind: 'text', text: 'export const x = 1\nlet y\n', truncated: false }
})

describe('FilesView', () => {
  beforeEach(() => { localStorage.clear(); hold = null })

  it('walks into a folder, opens a file with line numbers, and goes back through the breadcrumb', async () => {
    const w = await mountSuspended(FilesView, { props: { paneId: 'w1:p1' } })
    await flushPromises()
    expect(w.findAll('.files-entry').map(b => b.text())).toEqual(['src', '.env4 B', 'README.md8 B'])
    await w.findAll('.files-entry')[0]!.trigger('click')
    await flushPromises()
    expect(asked.at(-1)).toBe('src')
    await w.find('.files-entry').trigger('click')
    await flushPromises()
    expect(w.find('.files-num').text()).toBe('1\n2')
    expect(w.find('.files-text').text()).toBe('export const x = 1\nlet y')
    expect(w.find('.changes-location').text()).toContain('src/app.ts')
    await w.find('.files-crumb').trigger('click')
    await flushPromises()
    expect(w.find('.files-text').exists()).toBe(false)
    expect(w.findAll('.files-entry')).toHaveLength(3)
  })

  it('hides dotfiles when asked, and remembers it', async () => {
    const w = await mountSuspended(FilesView, { props: { paneId: 'w1:p1' } })
    await flushPromises()
    await w.find('.changes-toggle input').setValue(false)
    expect(w.findAll('.files-entry').map(b => b.text())).toEqual(['src', 'README.md8 B'])
    const again = await mountSuspended(FilesView, { props: { paneId: 'w1:p1' } })
    await flushPromises()
    expect(again.findAll('.files-entry')).toHaveLength(2)
  })

  it('stays on the folder when going back while a refresh is loading', async () => {
    const w = await mountSuspended(FilesView, { props: { paneId: 'w1:p1' } })
    await flushPromises()
    await w.findAll('.files-entry')[2]!.trigger('click')
    await flushPromises()
    let release = () => {}
    hold = new Promise((r) => { release = r })
    await w.find('button[aria-label="Refresh"]').trigger('click')
    await w.find('button[aria-label="Back to folder"]').trigger('click')
    release()
    await new Promise(r => setTimeout(r, 100))
    await flushPromises()
    expect(w.find('.files-text').exists()).toBe(false)
  })
})
