import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import BoardView from '~/components/BoardView.vue'
import { herdrState } from '~/composables/useHerdr'
import { machineGroups } from '~/composables/useMachineBar'
import { SCOPE_LOCAL } from '~/utils/boardScope'

// A machine's "Open the board" on the home list: `#/board?machine=<key>`.
registerEndpoint('/api/tasks', () => ({
  version: 'v1',
  machines: [
    { machine: '', status: 'ready', version: '1.2.1', tasks: [] },
    { machine: 'laptop', status: 'error', version: '1.2.1', tasks: [], error: 'Connection timed out', stale: true, at: 1760000000000 },
  ],
}))

const pass = { template: '<div><slot /></div>' }
async function open(path: string) {
  const router = useRouter()
  const w = await mountSuspended(BoardView, { route: path, global: { stubs: { UTooltip: pass, BoardPanel: true } } })
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
  return { w, router }
}

describe('the Board opened on a machine', () => {
  afterEach(() => {
    localStorage.removeItem('boardMachine')
    machineGroups.value = []
    herdrState.value = { ok: false, workspaces: [], panes: [] }
  })

  it('filters on that machine, as if picked on the Board', async () => {
    const { w, router } = await open('/board?machine=laptop')
    expect(localStorage.getItem('boardMachine')).toBe('laptop')
    await vi.waitFor(() => expect(router.currentRoute.value.query).toEqual({}))
    w.unmount()
  })

  it('the local machine, whose key is empty', async () => {
    const { w } = await open('/board?machine=')
    expect(localStorage.getItem('boardMachine')).toBe(SCOPE_LOCAL)
    w.unmount()
  })

  it('keeps an empty unreachable machine heading and its detail in scope', async () => {
    const { w } = await open('/board?machine=laptop')
    await vi.waitFor(() => expect(w.find('.board-machine-error').exists()).toBe(true))
    expect(w.find('.board-machine-error').text()).toContain('unreachable · read at')
    expect(w.find('.board-machine-error').element.parentElement?.getAttribute('aria-label')).toBe('Connection timed out')
    expect(w.find('.board-machine .board-fold').exists()).toBe(true)
    expect(w.find('.board-notes .error').exists()).toBe(false)
    await w.find('.board-machine .board-fold').trigger('click')
    expect(w.find('.board-machine-error').exists()).toBe(true)
    w.unmount()
  })

  it('hides the error and heading outside the selected machine', async () => {
    const { w } = await open('/board?machine=')
    await vi.waitFor(() => expect(w.find('.board-machine').exists()).toBe(true))
    expect(w.find('.board-machine-error').exists()).toBe(false)
    expect(w.find('[data-machine="laptop"]').exists()).toBe(false)
    expect(w.find('.board-notes .error').exists()).toBe(false)
    w.unmount()
  })

  it('limits errors to the selected machine group', async () => {
    machineGroups.value = [{ id: '*group:sample', name: 'Sample', machines: [''] }]
    const { w } = await open('/board?machine=*group:sample')
    await vi.waitFor(() => expect(w.find('.board-machine').exists()).toBe(true))
    expect(w.find('.board-machine-error').exists()).toBe(false)
    machineGroups.value = [{ id: '*group:sample', name: 'Sample', machines: ['', 'laptop'] }]
    await nextTick()
    expect(w.find('.board-machine-error').exists()).toBe(true)
    w.unmount()
  })

  it('a link to a task keeps its own handling', async () => {
    localStorage.setItem('boardMachine', 'laptop')
    const { w } = await open('/board?machine=&task=shop/1')
    expect(localStorage.getItem('boardMachine')).toBe('laptop')
    w.unmount()
  })
})
