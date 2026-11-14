// WHR-329: the home list's first load. Skeletons until every section's first
// read is in (Alfred, coordinators, tasks to handle, task agents), then the
// whole list in one paint; a later refresh keeps the data shown.
import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import HomeView from '~/components/HomeView.vue'
import { eventsOpen, herdrState } from '~/composables/useHerdr'
import { coordinators, loadCoordinators } from '~/composables/useCoordinators'
import { homeFirstLoad, homeListReady } from '~/composables/useHomeLoad'
import type { Pane } from '#shared/types'

// Each read waits until the test lets it answer.
const gates: Record<string, () => void> = {}
const gated = <T>(name: string, value: T) => () => new Promise<T>((done) => { gates[name] = () => done(value) })
registerEndpoint('/api/alfred', gated('alfred', { name: 'Alfred' }))
registerEndpoint('/api/pm/coordinators', gated('coordinators', [{ project: 'CO', name: 'demo app', agent: { program: 'claude' }, terminal: 'host/t1' }]))
registerEndpoint('/api/pm/handle', gated('handle', [{ id: 'CO-1', shown: 'CO-1', project: 'CO' }]))
registerEndpoint('/api/pm/agents', gated('agents', {}))
registerEndpoint('/api/quotas', () => ({}))
const open = async (name: string) => { await vi.waitFor(() => expect(gates[name]).toBeTypeOf('function')); gates[name]!(); delete gates[name] }

const pane = (id: string, coreAddress?: string) => ({ id, coreAddress, workspace: 'w1', tab: 'w1:t1', agent: 'claude', status: 'idle', title: `Agent ${id}`, cwd: '~/project' }) as Pane
const pass = { template: '<div><slot /></div>' }

afterEach(() => {
  herdrState.value = { ok: false, workspaces: [], panes: [] }
  eventsOpen.value = false
  coordinators.value = []
  homeListReady.value = false
  Object.assign(homeFirstLoad, { alfred: false, coordinators: false, handle: false, agents: false, quotas: false })
})

it('shows skeletons until every section is read, then the whole list at once, and keeps it on refresh', async () => {
  const panes = [pane('w1:p1', 'host/t1'), pane('w1:p2')]
  herdrState.value = { ok: true, panes, workspaces: [{ id: 'w1', number: 1, label: 's', focused: false }] } as never
  eventsOpen.value = true
  const w = await mountSuspended(HomeView, { global: { stubs: { UContextMenu: pass, UTooltip: pass } } })
  const sections = () => w.get('[data-testid="home-sections"]').element as HTMLElement
  await vi.waitFor(() => expect(w.find('[data-testid="home-skeleton"]').exists()).toBe(true))
  expect(sections().style.display).toBe('none')

  // Some sections in: still skeletons, nothing drawn yet.
  await open('coordinators')
  await open('alfred')
  await open('handle')
  await vi.waitFor(() => expect(homeFirstLoad.handle).toBe(true))
  expect(w.find('[data-testid="home-skeleton"]').exists()).toBe(true)
  expect(sections().style.display).toBe('none')

  // The last one: everything in one paint, coordinator and tasks to review included.
  await open('agents')
  await vi.waitFor(() => expect(w.find('[data-testid="home-skeleton"]').exists()).toBe(false))
  expect(sections().style.display).toBe('')
  expect(w.findAll('[data-testid="coordinator-row"]')).toHaveLength(1)
  expect(w.find('[data-testid="tasks-to-review"]').exists()).toBe(true)

  // A refresh in flight: the data stays, no skeleton.
  const refresh = loadCoordinators()
  await new Promise(r => setTimeout(r, 400))
  expect(w.find('[data-testid="home-skeleton"]').exists()).toBe(false)
  expect(w.findAll('[data-testid="coordinator-row"]')).toHaveLength(1)
  await open('coordinators')
  await refresh
  w.unmount()
})
