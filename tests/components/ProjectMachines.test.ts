// The project sheet's Machines block: home read only, an added machine saved
// with its clone through project-update, then its readiness check shown; each
// machine's last check, run again with Check; remove.
import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import ProjectMachines from '~/components/ProjectMachines.vue'
import { herdrState } from '~/composables/useHerdr'
import type { Project } from '#shared/pm/project'
import type { MachineInfo } from '#shared/types'
import { pick, selectLabels } from '../helpers/select'

const posts: [string, Record<string, unknown>][] = []
registerEndpoint('/api/pm/project-update', { method: 'POST', handler: async (e) => { posts.push(['update', await readBody(e)]); return {} } })
registerEndpoint('/api/pm/project-machine-check', { method: 'POST', handler: async (e) => { posts.push(['check', await readBody(e)]); return { items: [], at: 1, refused: 'gh login: not logged in' } } })

const m = (key: string, label: string, status: MachineInfo['status'] = 'online') => ({ key, label, local: !key, status, error: null }) as MachineInfo
let w: Awaited<ReturnType<typeof mountSuspended>> | null = null
afterEach(() => { w?.unmount(); w = null; posts.length = 0 })

it('adds a connected machine with its clone, shows its check, and removes one', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [], machines: [m('', 'Host'), m('a', 'Laptop'), m('b', 'Builder'), m('c', 'Away', 'offline')] }
  const project = { key: 'WEB', name: 'Web', machine: '', path: '~/project', machines: ['', 'a'], clones: { a: '~/web' } } as Project
  const b = w = await mountSuspended(ProjectMachines, { props: { project } })
  expect(b.text()).toContain('Host Home')
  expect(b.findAll('[data-testid="pm-machine"]').map(x => x.text().replace(/\u200e/g, ' ').trim())).toEqual(['Laptop ~/web Not checked yet'])
  await b.setProps({ ready: { a: '' } })
  expect(b.find('[data-testid="pm-machine-ready"]').text()).toBe('Ready')
  expect(selectLabels(b, 'pm-machine-pick')).toEqual(['Builder'])

  await pick(b, 'pm-machine-pick', 'b')
  await b.find('[data-testid="pm-machine-clone"]').setValue('~/project')
  await b.find('form').trigger('submit')
  await vi.waitFor(() => expect(posts).toEqual([
    ['update', { key: 'WEB', machines: ['a', 'b'], clones: { b: '~/project' } }],
    ['check', { key: 'WEB', machine: 'b' }],
  ]))
  expect(b.emitted('changed')).toHaveLength(1)

  await b.setProps({ project: { ...project, machines: ['', 'a', 'b'], clones: { a: '~/web', b: '~/project' } } })
  await vi.waitFor(() => expect(b.findAll('[data-testid="pm-machine-ready"]').map(x => x.text())).toEqual(['Ready', 'Not ready: gh login: not logged in']))
  // Check runs that machine's check again; its answer replaces the last one.
  await b.findAll('[data-testid="pm-machine-check"]')[0]!.trigger('click')
  await vi.waitFor(() => expect(b.findAll('[data-testid="pm-machine-ready"]')[0]!.text()).toBe('Not ready: gh login: not logged in'))
  expect(posts[2]).toEqual(['check', { key: 'WEB', machine: 'a' }])
  await b.findAll('[data-testid="pm-machine-remove"]')[0]!.trigger('click')
  await vi.waitFor(() => expect(posts[3]).toEqual(['update', { key: 'WEB', machines: ['b'], clones: {} }]))
})
