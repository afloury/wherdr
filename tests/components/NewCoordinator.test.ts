import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import NewAgentSheet from '~/components/NewAgentSheet.vue'
import { newAgentOpen } from '~/composables/useUi'
import { herdrState } from '~/composables/useHerdr'
import { coordinators, resumedCoordinators } from '~/composables/useCoordinators'
import type { CoordinatorView } from '#shared/pm/coordinator'
import type { Pane } from '#shared/types'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)

const opus = { program: 'claude' as const }
let views: CoordinatorView[] = []
const posts: { url: string, body: Record<string, unknown> }[] = []
registerEndpoint('/api/config', () => ({ kinds: ['claude', 'codex'], home: '/repos', dirs: ['/repos'], push: { enabled: false, key: null, devices: 0 } }))
registerEndpoint('/api/pm/coordinators', () => views)
registerEndpoint('/api/pm/coordinator-start', { method: 'POST', handler: async (e) => {
  posts.push({ url: '/api/pm/coordinator-start', body: await readBody(e) })
  herdrState.value = { ...herdrState.value, panes: [...herdrState.value.panes, { id: 'w2:p1', coreAddress: 'host/t9', status: 'idle', agent: 'claude', workspace: 'w2', tab: 't' } as Pane] }
  return { terminal: 'host/t9' }
} })

const stubs = { AppSheet: { template: '<section><slot /><slot name="footer" /></section>' } }
const running = { id: 'w1:p1', coreAddress: 'host/t1', status: 'idle', agent: 'codex', workspace: 'w1', tab: 't' } as Pane
async function openSheet(v: CoordinatorView[], panes: Pane[] = []) {
  views = v
  herdrState.value = { ok: true, workspaces: [], panes }
  const w = await mountSuspended(NewAgentSheet, { global: { stubs } })
  newAgentOpen.value = true
  await vi.waitFor(() => expect(w.find('[data-kind="coordinator"]').exists()).toBe(true))
  await w.get('[data-kind="coordinator"]').trigger('click')
  await flushPromises()
  return w
}
afterEach(() => {
  newAgentOpen.value = false; posts.length = 0; navigate.mockClear(); coordinators.value = []; views = []
  herdrState.value = { ok: false, workspaces: [], panes: [] }
})

it('lists the projects, then starts the chosen one\'s coordinator with the chosen agent and opens it', async () => {
  const w = await openSheet([
    { project: 'CO', name: 'Company', agent: opus, template: 'company' },
    { project: 'WEB', name: 'Website', agent: { program: 'codex' }, template: 'company' },
  ])
  expect(w.findAll('[data-project]').map(b => b.text())).toEqual(['COCompany', 'WEBWebsite'])
  // The folder and first message belong to agents, not to a coordinator.
  expect(w.find('#newPrompt').exists()).toBe(false)
  expect(w.get('[data-testid="coordinator-start"]').text()).toBe('Start with Claude')
  // Another project: its own default agent.
  await w.get('[data-project="WEB"]').trigger('click')
  expect(w.get('[data-testid="coordinator-start"]').text()).toBe('Start with Codex')
  // Programs only, from Settings › Agents.
  await w.get('[data-project="CO"]').trigger('click')
  expect(w.findAll('[data-agent]').map(b => b.text())).toEqual(['Claude', 'Codex'])
  await w.get('[data-agent="codex"]').trigger('click')
  expect(w.text()).toContain('The default stays Claude.')
  await w.get('[data-testid="coordinator-start"]').trigger('click')
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/a/w2%3Ap1'))
  expect(posts).toEqual([{ url: '/api/pm/coordinator-start', body: { project: 'CO', program: 'codex' } }])
  expect(newAgentOpen.value).toBe(false)
  w.unmount()
})

it('opens a running coordinator instead of starting a second one', async () => {
  const w = await openSheet([{ project: 'CO', name: 'Company', agent: opus, ran: opus, terminal: 'host/t1', template: 'company' }], [running])
  expect(w.get('[data-project="CO"]').text()).toContain('Running')
  await w.get('[data-testid="coordinator-open"]').trigger('click')
  expect(navigate).toHaveBeenCalledWith('/a/w1%3Ap1')
  expect(posts).toEqual([])
  w.unmount()
})

it('running with another agent: a new conversation, or resume it', async () => {
  const w = await openSheet([{ project: 'CO', name: 'Company', agent: opus, ran: { program: 'codex' }, terminal: 'host/t1', template: 'company' }], [running])
  expect(w.find('[data-testid="coordinator-open"]').exists()).toBe(false)
  expect(w.get('[data-testid="coordinator-other-agent"]').text()).toBe('Its conversation runs with Codex.')
  expect(w.get('[data-testid="coordinator-new"]').text()).toBe('New conversation with Claude')
  await w.get('[data-testid="coordinator-resume"]').trigger('click')
  expect(navigate).toHaveBeenCalledWith('/a/w1%3Ap1')
  expect(resumedCoordinators.value).toContain('host/t1')
  expect(posts).toEqual([])
  resumedCoordinators.value = []
  localStorage.removeItem('wherdr.coordinatorsResumed')
  w.unmount()
})

it('a project without a template says it needs one and links to Settings › Projects', async () => {
  const w = await openSheet([{ project: 'CO', name: 'Company', agent: opus }])
  expect(w.get('[data-testid="coordinator-no-template"]').text()).toContain('This project needs a template')
  expect(w.get('[data-testid="coordinator-settings"]').attributes('href')).toContain('/settings?section=projects')
  expect(w.get('[data-testid="coordinator-start"]').attributes('disabled')).toBeDefined()
  w.unmount()
})

it('the main coordinator (all projects) starts with no template', async () => {
  const w = await openSheet([{ project: '_main', name: 'Main coordinator', main: true, agent: opus }])
  expect(w.get('[data-project="_main"]').text()).toBe('MainAll projects')
  expect(w.find('[data-testid="coordinator-no-template"]').exists()).toBe(false)
  await w.get('[data-testid="coordinator-start"]').trigger('click')
  await vi.waitFor(() => expect(posts[0]?.body).toMatchObject({ project: '_main' }))
  await vi.waitFor(() => expect(navigate).toHaveBeenCalled())
  w.unmount()
})

it('offers no coordinator without project management', async () => {
  views = []
  const w = await mountSuspended(NewAgentSheet, { global: { stubs } })
  newAgentOpen.value = true
  await flushPromises()
  expect(w.find('[data-kind="claude"]').exists()).toBe(true)
  expect(w.find('[data-kind="coordinator"]').exists()).toBe(false)
  w.unmount()
})
