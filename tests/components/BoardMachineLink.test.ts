import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import BoardView from '~/components/BoardView.vue'
import { herdrState } from '~/composables/useHerdr'
import { SCOPE_LOCAL } from '~/utils/boardScope'

// A machine's "Open the board" on the home list: `#/board?machine=<key>`.
registerEndpoint('/api/tasks', () => ({
  version: 'v1',
  machines: [
    { machine: '', status: 'ready', version: '1.2.1', tasks: [] },
    { machine: 'laptop', status: 'ready', version: '1.2.1', tasks: [] },
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

  it('a link to a task keeps its own handling', async () => {
    localStorage.setItem('boardMachine', 'laptop')
    const { w } = await open('/board?machine=&task=shop/1')
    expect(localStorage.getItem('boardMachine')).toBe('laptop')
    w.unmount()
  })
})
