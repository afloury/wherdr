import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import FilesView from '~/components/FilesView.vue'

vi.mock('~/components/PdfPreview.vue', () => ({ default: { props: ['src', 'title'], template: '<div class="files-pdf" :data-src="src" :title="title" />' } }))

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
const reads: Record<string, unknown>[] = []
registerEndpoint('/api/files/read', async (event) => {
  if (hold) await hold
  const q = getQuery(event)
  reads.push(q)
  // A path written in the conversation comes back absolute.
  const path = String(q.path).replace(/^~(?=\/)/, '/home/user')
  if (path.endsWith('.pdf')) return { path, size: 11_000_000, kind: 'pdf', truncated: false }
  if (path.endsWith('.zip')) return { path, size: 40, kind: 'binary', truncated: false }
  return { path, size: 19, kind: 'text', text: 'export const x = 1\nlet y\n', truncated: false }
})
const downloads: Record<string, unknown>[] = []
registerEndpoint('/api/files/download', (event) => {
  const q = getQuery(event)
  downloads.push(q)
  return 'a,b\r\n1,2\r\n'
})

describe('FilesView', () => {
  beforeEach(() => { localStorage.clear(); hold = null })
  afterEach(() => vi.restoreAllMocks())

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

  it('downloads the file it shows', async () => {
    // Nuxt uses happy-dom's response Blob but keeps Node's URL API, which
    // rejects that Blob. Model the browser object URL boundary explicitly.
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:files-view-download')
    const saved: { href: string, name: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push({ href: this.href, name: this.download }) })
    const w = await mountSuspended(FilesView, { props: { paneId: 'w1:p1' } })
    await flushPromises()
    await w.findAll('.files-entry')[2]!.trigger('click')
    await flushPromises()
    await w.find('button[aria-label="Download"]').trigger('click')
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(await (createObjectURL.mock.calls[0]![0] as Blob).text()).toBe('a,b\r\n1,2\r\n')
    expect(saved[0]!.href).toBe('blob:files-view-download')
    expect(downloads.at(-1)).toEqual({ pane: 'w1:p1', path: 'README.md' })
    expect(saved[0]).toMatchObject({ href: expect.stringMatching(/^blob:/), name: 'README.md' })
  })

  it('shows one file named in the conversation, with no folder around it, and downloads it', async () => {
    // Nuxt uses happy-dom's response Blob but keeps Node's URL API, which
    // rejects that Blob. Model the browser object URL boundary explicitly.
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:files-view-download')
    const saved: { href: string, name: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push({ href: this.href, name: this.download }) })
    const listed = asked.length
    const w = await mountSuspended(FilesView, { props: { paneId: 'w1:p1', file: '~/exports/report.csv' } })
    await flushPromises()
    expect(asked).toHaveLength(listed)
    expect(reads.at(-1)).toEqual({ pane: 'w1:p1', path: '~/exports/report.csv', from: 'chat' })
    expect(w.find('.files-crumb.current').text()).toBe('report.csv')
    expect(w.find('.files-sep').exists()).toBe(false)
    expect(w.find('button[aria-label="Back to folder"]').exists()).toBe(false)
    expect(w.find('.changes-location').text()).toContain('/home/user/exports/report.csv')
    await w.find('button[aria-label="Download"]').trigger('click')
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(await (createObjectURL.mock.calls[0]![0] as Blob).text()).toBe('a,b\r\n1,2\r\n')
    expect(saved[0]!.href).toBe('blob:files-view-download')
    expect(downloads.at(-1)).toEqual({ pane: 'w1:p1', path: '/home/user/exports/report.csv', from: 'chat' })
    expect(saved[0]!.name).toBe('report.csv')
    // Refresh reads the same file again, still with no folder.
    await w.find('button[aria-label="Refresh"]').trigger('click')
    await flushPromises()
    expect(reads.at(-1)).toEqual({ pane: 'w1:p1', path: '~/exports/report.csv', from: 'chat' })
    expect(w.find('.files-text').text()).toBe('export const x = 1\nlet y')
    expect(asked).toHaveLength(listed)
  })

  it('shows a PDF in the canvas viewer from the download path, with Open; other binaries stay a notice', async () => {
    const w = await mountSuspended(FilesView, { props: { paneId: 'w1:p1', file: '~/docs/manual.pdf' } })
    await flushPromises()
    const url = '/api/files/download?pane=w1%3Ap1&path=%2Fhome%2Fuser%2Fdocs%2Fmanual.pdf&from=chat&inline=1'
    const frame = w.find('.files-pdf')
    expect(frame.attributes('data-src')).toBe(url)
    expect(frame.attributes('sandbox')).toBeUndefined()
    expect(frame.attributes('title')).toBe('/home/user/docs/manual.pdf')
    const open = w.find('a[aria-label="Open"]')
    expect(open.attributes('href')).toBe(url)
    expect(open.attributes('target')).toBe('_blank')
    expect(w.find('button[aria-label="Download"]').exists()).toBe(true)
    // Refresh loads the viewer again.
    await w.find('button[aria-label="Refresh"]').trigger('click')
    await flushPromises()
    expect(w.find('.files-pdf').element).not.toBe(frame.element)

    const zip = await mountSuspended(FilesView, { props: { paneId: 'w1:p1', file: '~/docs/archive.zip' } })
    await flushPromises()
    expect(zip.find('iframe').exists()).toBe(false)
    expect(zip.find('a[aria-label="Open"]').exists()).toBe(false)
    expect(zip.find('.changes-notice').text()).toBe('Binary file')
  })
})
