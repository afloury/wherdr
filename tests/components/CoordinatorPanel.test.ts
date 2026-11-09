import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useRouter } from '#app'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import CoordinatorPanel from '~/components/CoordinatorPanel.vue'
import CoordinatorButton from '~/components/CoordinatorButton.vue'
import { agentOrder, herdrState, hiddenAgents } from '~/composables/useHerdr'
import { coordinators, resumedCoordinators } from '~/composables/useCoordinators'
import type { CoordinatorView } from '#shared/pm/coordinator'
import type { Pane } from '#shared/types'
import { pick } from '../helpers/select'

const posts: { url: string, body: Record<string, unknown> }[] = []
let views: CoordinatorView[] = []
const post = (url: string, reply: () => unknown) => registerEndpoint(url, { method: 'POST', handler: async (e) => { posts.push({ url, body: await readBody(e) }); return reply() } })
registerEndpoint('/api/pm/coordinators', () => views)
post('/api/pm/coordinator-agent', () => ({}))
post('/api/pm/coordinator-start', () => ({ terminal: 'host/t2' }))
herdrState.value = { ok: true, workspaces: [], panes: [{ id: 'w1:p1', coreAddress: 'host/t1', status: 'idle', agent: 'codex', workspace: 'w', tab: 't' } as Pane] }

const view = (more: Partial<CoordinatorView> = {}): CoordinatorView => ({ project: 'CO', name: 'Company', agent: { program: 'claude' }, ...more })
let w: Awaited<ReturnType<typeof mountSuspended>> | null = null
const mount = async (c: CoordinatorView, open = false) => (w = await mountSuspended(CoordinatorPanel, { props: { c, open } }))
afterEach(() => { w?.unmount(); w = null; posts.length = 0; coordinators.value = []; hiddenAgents.value = []; agentOrder.value = [] })

it('says which agent answers, and changes the default in one gesture', async () => {
  const b = await mount(view(), true)
  // No conversation yet: the button says which agent will answer.
  expect(b.find('[data-testid="coordinator-open"]').text()).toBe('Start with Claude')
  await pick(b, 'coordinator-agent', 'codex')
  await vi.waitFor(() => expect(posts).toEqual([{ url: '/api/pm/coordinator-agent', body: { project: 'CO', program: 'codex' } }]))
})

it('in Alfred\'s conversation: no agent select (its row\'s "Restart with…" changes it)', async () => {
  const b = await mount(view({ project: '_main', name: 'Jarvis', main: true }))
  expect(b.find('[data-testid="coordinator-agent"]').exists()).toBe(false)
})

it('header button: a clock, the autopilot\'s state, and a tap opens the autopilot only (no workflow proposal)', async () => {
  w = await mountSuspended(CoordinatorButton, { attachTo: document.body, props: { c: view({ autopilot: { on: true, goal: '', events: [], perDay: 1, atOnce: 1 }, asleep: 'idle', nextWake: new Date().setHours(23, 30, 0, 0), proposal: { diff: '+ x', at: 1 } }) } })
  const btn = w.get('[data-testid="coordinator-button"]')
  expect(btn.attributes('data-state')).toBe('idle')
  expect(btn.attributes('aria-label')).toBe('Autopilot: Asleep')
  expect(btn.find('.coord-btn-icon').classes()).toContain('i-lucide-clock')
  await btn.trigger('click')
  await vi.waitFor(() => expect(document.querySelector('[data-testid="coordinator-autopilot"]')).not.toBeNull())
  expect(document.querySelector('[data-testid="autopilot-next-wake"]')?.textContent).toMatch(/^Next wake (23:30|11:30)/i)
  expect(document.querySelector('[data-testid="workflow-change"]')).toBeNull()
})

it('with no default set, or its default unchecked in Settings › Agents, offers the user\'s first agent', async () => {
  agentOrder.value = ['codex']
  const b = await mount(view({ agent: undefined }), true)
  expect(b.find('[data-testid="coordinator-open"]').text()).toBe('Start with Codex')
  hiddenAgents.value = ['codex']
  await b.setProps({ c: view() })
  expect(b.find('[data-testid="coordinator-open"]').text()).toBe('Start with Claude')
  hiddenAgents.value = ['claude']
  await nextTick()
  expect(b.find('[data-testid="coordinator-open"]').text()).toBe('Start with Codex')
})

it('warns when the kept conversation ran with another agent, and offers a new one first', async () => {
  const b = await mount(view({ ran: { program: 'codex' }, terminal: 'host/t1' }), true)
  const banner = b.find('[data-testid="coordinator-other-agent"]')
  expect(banner.text()).toContain('The previous conversation used Codex. The default is Claude.')
  expect(banner.findAll('button').map(x => x.text())).toEqual(['New conversation with Claude', 'Resume with Codex'])
  expect(b.find('[data-testid="coordinator-open"]').exists()).toBe(false)
  await b.find('[data-testid="coordinator-new"]').trigger('click')
  await vi.waitFor(() => expect(posts[0]).toEqual({ url: '/api/pm/coordinator-start', body: { project: 'CO', program: 'claude' } }))
})

it('remembers "Resume with" after a reload', async () => {
  const b = await mount(view({ ran: { program: 'codex' }, terminal: 'host/t1' }), true)
  await b.find('[data-testid="coordinator-resume"]').trigger('click')
  // It opens the conversation: wait until the agent page (and its lazy imports) is there,
  // else they load after the test environment is torn down.
  const router = useRouter()
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/a/w1:p1'), { timeout: 15000 })
  expect(b.find('[data-testid="coordinator-other-agent"]').exists()).toBe(false)
  expect(JSON.parse(localStorage.getItem('wherdr.coordinatorsResumed')!)).toEqual(['host/t1'])
  resumedCoordinators.value = []
  localStorage.removeItem('wherdr.coordinatorsResumed')
  await router.replace('/')
})

it('shows no warning when the kept conversation is the default agent\'s', async () => {
  const b = await mount(view({ ran: { program: 'claude' }, terminal: 'host/t1' }), true)
  expect(b.find('[data-testid="coordinator-other-agent"]').exists()).toBe(false)
  expect(b.find('[data-testid="coordinator-open"]').text()).toBe('Open')
})

it('names the autopilot with its subtitle and links a project\'s to its Workflow tab', async () => {
  const b = await mount(view({ proposal: { diff: '+ x', at: 1 } }))
  expect(b.find('[data-testid="part-subtitle"]').text()).toBe('When the project works without you')
  const link = b.find('[data-testid="part-link"]')
  expect(link.text()).toBe('Tasks it starts follow the Workflow tab')
  expect(link.attributes('href')).toBe('#/settings?section=projects&project=CO&tab=workflow')
  expect(b.find('[data-testid="workflow-change"]').exists()).toBe(false)
})
