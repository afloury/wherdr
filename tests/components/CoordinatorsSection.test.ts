// WHR-398: the COORDINATORS section at the top of the agent list: the main
// coordinator first, then the project coordinators that run. One tap opens a
// conversation, or starts the main coordinator with its default agent.
import { afterEach, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import CoordinatorsSection from '~/components/CoordinatorsSection.vue'
import { herdrState } from '~/composables/useHerdr'
import { MAIN, type CoordinatorView } from '#shared/pm/coordinator'
import type { Pane } from '#shared/types'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)

const posts: unknown[] = []
let views: CoordinatorView[] = []
registerEndpoint('/api/pm/coordinators', () => views)
registerEndpoint('/api/pm/coordinator-start', { method: 'POST', handler: async (e) => { posts.push(await readBody(e)); return { terminal: 'host/t9' } } })

const pane = (id: string, coreAddress: string) => ({ id, coreAddress, status: 'idle', agent: 'claude', workspace: 'w', tab: 't' }) as Pane
const view = (project: string, more: Partial<CoordinatorView> = {}): CoordinatorView => ({ project, name: project, agent: { program: 'claude', model: 'opus' }, ...more })
let w: Awaited<ReturnType<typeof mountSuspended>> | null = null
afterEach(() => { w?.unmount(); w = null; posts.length = 0; navigate.mockReset() })

it('shows the main coordinator first, then the running project coordinators only', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [pane('w:p1', 'host/t1')] }
  views = [view(MAIN, { main: true }), view('CO', { terminal: 'host/t1' }), view('ST')]
  w = await mountSuspended(CoordinatorsSection)
  await vi.waitFor(() => expect(w!.findAll('button')).toHaveLength(2))
  const [main, co] = w.findAll('button')
  expect(main!.attributes('data-testid')).toBe('coordinator-main')
  expect(main!.text()).toContain('Coordinator')
  expect(main!.text()).toContain('Start with Claude Opus')
  expect(co!.text()).toContain('CO coordinator')
  // Running: one tap opens its conversation, nothing started.
  await co!.trigger('click')
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/a/w%3Ap1'))
  expect(posts).toEqual([])
})

it('starts the main coordinator with its default agent in one tap, then opens it', async () => {
  herdrState.value = { ok: true, workspaces: [], panes: [] }
  views = [view(MAIN, { main: true })]
  w = await mountSuspended(CoordinatorsSection)
  await vi.waitFor(() => expect(w!.find('[data-testid="coordinator-main"]').exists()).toBe(true))
  await w.find('[data-testid="coordinator-main"]').trigger('click')
  await vi.waitFor(() => expect(posts).toEqual([{ project: MAIN }]))
  herdrState.value = { ok: true, workspaces: [], panes: [pane('w:p9', 'host/t9')] }
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/a/w%3Ap9'))
})

it('is hidden while project management is off', async () => {
  views = []
  w = await mountSuspended(CoordinatorsSection)
  await new Promise(r => setTimeout(r, 50))
  expect(w.find('[data-testid="coordinators"]').exists()).toBe(false)
})
