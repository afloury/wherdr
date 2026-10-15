import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { getQuery } from 'h3'
import DirBrowser from '~/components/DirBrowser.vue'

const HOME = '/home/user'
registerEndpoint('/api/dirs', (event) => {
  const q = getQuery(event)
  const path = String(q.path || HOME)
  const remote = q.machine ? { remote: true } : {}
  if (path === `${HOME}/Documents`) return { path, parent: HOME, home: HOME, dirs: [], denied: 'macos', ...remote }
  if (path === `${HOME}/locked`) return { path, parent: HOME, home: HOME, dirs: [], denied: 'permission' }
  if (path === `${HOME}/empty`) return { path, parent: HOME, home: HOME, dirs: [] }
  return { path, parent: null, home: HOME, dirs: [{ name: 'Documents', path: `${HOME}/Documents`, git: false }] }
})

async function open(start: string, machine = '') {
  const w = await mountSuspended(DirBrowser, { props: { start, machine } })
  await flushPromises()
  return w
}

describe('DirBrowser', () => {
  it('explains a folder macOS refuses over SSH instead of "No subfolders", and keeps Parent', async () => {
    const w = await open(`${HOME}/Documents`, 'abcd1234')
    const box = w.find('.dir-denied')
    expect(box.exists()).toBe(true)
    expect(box.text()).toContain('macOS blocks access to this folder')
    expect(box.text()).toContain('Allow full disk access for remote users')
    expect(w.text()).not.toContain('No subfolders.')
    const parent = w.findAll('button').find(b => b.text() === 'Parent')!
    expect(parent.attributes('disabled')).toBeUndefined()
    await parent.trigger('click')
    await flushPromises()
    expect(w.find('.dir-denied').exists()).toBe(false)
    expect(w.findAll('.dir-list button').map(b => b.text())).toEqual(['Documents'])
  })

  it('points a local Mac to Full Disk Access', async () => {
    const box = (await open(`${HOME}/Documents`)).find('.dir-denied')
    expect(box.text()).toContain('Full Disk Access')
    expect(box.text()).not.toContain('Remote Login')
  })

  it('says "Permission denied" for plain rights, and "No subfolders" only for an empty folder', async () => {
    expect((await open(`${HOME}/locked`)).find('.dir-denied').text()).toContain('Permission denied')
    const empty = await open(`${HOME}/empty`)
    expect(empty.find('.dir-denied').exists()).toBe(false)
    expect(empty.text()).toContain('No subfolders.')
  })
})
