// WHR-395: the agent list header has a Board button, as in v2.5. It opens the
// board when project management is on and has a project, and Settings ›
// Projects otherwise (an empty board says nothing).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import HomeView from '~/components/HomeView.vue'
import { eventsOpen, herdrState } from '~/composables/useHerdr'
import { boardEntry } from '~/utils/boardEntry'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)

let overview: unknown = { enabled: false, projects: [], templates: [] }
registerEndpoint('/api/pm/overview', () => overview)
registerEndpoint('/api/quotas', () => ({ claude: null, codex: null }))
registerEndpoint('/api/machine/order', () => ({ order: [] }))
registerEndpoint('/api/machine/awake', () => ({ supported: false }))

const pass = { template: '<div><slot /></div>' }
const project = { key: 'demo', name: 'Demo', machine: '', path: '/tmp/demo', base: 'main', template: 'default' }

async function clickBoard(): Promise<string> {
  const w = await mountSuspended(HomeView, { global: { stubs: { UContextMenu: pass, UTooltip: pass } } })
  const btn = w.find('[data-testid="home-board"]')
  expect(btn.exists()).toBe(true)
  await btn.trigger('click')
  await vi.waitFor(() => expect(navigate).toHaveBeenCalled())
  w.unmount()
  return navigate.mock.calls[0]![0]
}

describe('home list: Board button', () => {
  beforeEach(() => {
    herdrState.value = { ok: true, panes: [], workspaces: [] } as never
    eventsOpen.value = true
    navigate.mockReset()
  })
  afterEach(() => { herdrState.value = { ok: false, workspaces: [], panes: [] }; eventsOpen.value = false })

  it('project management off: opens Settings › Projects', async () => {
    overview = { enabled: false, projects: [], templates: [] }
    expect(await clickBoard()).toBe('/settings?section=projects')
  })

  it('on without a project: opens Settings › Projects', async () => {
    overview = { enabled: true, projects: [], templates: [] }
    expect(await clickBoard()).toBe('/settings?section=projects')
  })

  it('on with a project: opens the board', async () => {
    overview = { enabled: true, projects: [project], templates: [] }
    expect(await clickBoard()).toBe('/board')
  })

  it('overview unreadable: the board, which shows its own error', () => {
    expect(boardEntry(null)).toBe('/board')
  })
})
