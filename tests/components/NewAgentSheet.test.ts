import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import NewAgentSheet from '~/components/NewAgentSheet.vue'
import { newAgentOpen } from '~/composables/useUi'
import { herdrState } from '~/composables/useHerdr'
import { newSplit } from '~/composables/useSpaces'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)

registerEndpoint('/api/tasks/links', () => ({ version: '1', machines: [{ machine: '', tasks: [], coordinators: [], repos: [{ repo: 'demo', root: '/repos/demo', branch: 'main', behind: 0 }] }, { machine: 'remote', tasks: [], coordinators: [], repos: [{ repo: 'remote-demo', root: '/srv/demo', branch: 'main', behind: 0 }] }] }))
registerEndpoint('/api/isgit', () => ({ git: true }))
registerEndpoint('/api/config', () => ({ kinds: ['claude', 'codex'], home: '/repos', dirs: ['/repos'], machines: [{ key: '', label: 'Local', local: true, online: true, home: '/repos', dirs: [], kinds: ['claude'] }, { key: 'remote', label: 'Remote', local: false, online: true, home: '/srv', dirs: [], kinds: ['codex'] }], push: { enabled: false, key: null, devices: 0 } }))

const stubs = {
  AppSheet: { template: '<section><slot /><slot name="footer" /></section>' },
  DirBrowser: { name: 'DirBrowser', props: ['machine'], emits: ['choose', 'cancel'], template: '<button class="choose-demo" @click="$emit(\'choose\', \'/repos/new-demo\')">Choose</button>' },
}

describe('New project coordinator', () => {
  afterEach(() => { newAgentOpen.value = false; newSplit.value = null; navigate.mockClear(); herdrState.value = { ok: false, workspaces: [], panes: [] } })

  it('offers board repositories before the folder browser, without agent-only fields', async () => {
    const w = await mountSuspended(NewAgentSheet, { global: { stubs } })
    newAgentOpen.value = true
    await flushPromises()
    await w.get('[data-kind="coordinator"]').trigger('click')
    const vm = w.vm as unknown as { repoItems: { value: string }[], repoPick: string, dir: string, project: string, launch: () => Promise<void> }
    expect(vm.repoItems.map(r => r.value)).toEqual(['demo', '__other'])
    expect(vm.project).toBe('demo')
    await vm.launch()
    expect(navigate).toHaveBeenLastCalledWith({ path: '/board', query: { machine: '', coordinator: 'demo' } })
    expect(w.find('#newPrompt').exists()).toBe(false)
    expect(w.find('#newName').exists()).toBe(false)
    vm.repoPick = '__other'
    vm.dir = '/repos/demo'
    expect(vm.project).toBe('demo')
    await flushPromises()
    await w.get('.dir-pick').trigger('click')
    await w.get('.choose-demo').trigger('click')
    expect(vm.project).toBe('/repos/new-demo')
    await vm.launch()
    expect(navigate).toHaveBeenCalledWith({ path: '/board', query: { machine: '', coordinator: '/repos/new-demo' } })
    newAgentOpen.value = true
    await flushPromises()
    expect(w.find('.choose-demo').exists()).toBe(false)
    await w.get('[data-kind="claude"]').trigger('click')
    expect(w.find('#newPrompt').exists()).toBe(true)
    w.unmount()
  })

  it('uses the selected machine for its repositories, browser and conversation', async () => {
    herdrState.value = { ok: true, workspaces: [], panes: [], machines: [{ key: '', label: 'Local', local: true, status: 'online', error: null }, { key: 'remote', label: 'Remote', local: false, status: 'online', error: null }] }
    const w = await mountSuspended(NewAgentSheet, { global: { stubs } })
    newAgentOpen.value = true
    await flushPromises()
    const vm = w.vm as unknown as { machine: string, repoPick: string, dir: string, project: string, launch: () => Promise<void> }
    await vi.waitFor(() => expect(w.find('[data-machine="remote"]').exists()).toBe(true))
    await w.get('[data-machine="remote"]').trigger('click')
    await flushPromises()
    await w.get('[data-kind="coordinator"]').trigger('click')
    expect(vm.project).toBe('remote-demo')
    await vm.launch()
    expect(navigate).toHaveBeenLastCalledWith({ path: '/board', query: { machine: 'remote', coordinator: 'remote-demo' } })
    vm.repoPick = '__other'
    await flushPromises()
    await w.get('.dir-pick').trigger('click')
    expect(w.findComponent({ name: 'DirBrowser' }).props('machine')).toBe('remote')
    await w.get('.choose-demo').trigger('click')
    await vm.launch()
    expect(navigate).toHaveBeenCalledWith({ path: '/board', query: { machine: 'remote', coordinator: '/repos/new-demo' } })
    w.unmount()
  })

  it('keeps splits limited to agents and terminals', async () => {
    newSplit.value = { paneId: 'w1:p1', direction: 'right' }
    const w = await mountSuspended(NewAgentSheet, { global: { stubs } })
    expect(w.find('[data-kind="coordinator"]').exists()).toBe(false)
    w.unmount()
  })
})
