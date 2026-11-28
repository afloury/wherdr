import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import CommandMenu from '~/components/CommandMenu.vue'
import { herdrState } from '~/composables/useHerdr'
import { coordinators } from '~/composables/useCoordinators'
import { taskAgents } from '~/composables/useTaskAgents'
import type { Pane } from '#shared/types'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)

registerEndpoint('/api/pm/board', () => ({
  projects: [{ key: 'DEMO', name: 'Demo app', columns: [], types: [] }],
  cards: [{ id: 'DEMO-7', shown: 'DEMO-7', color: 'blue', project: 'DEMO', title: 'Fix the login banner', description: '' }],
}))
registerEndpoint('/api/search', () => ({
  hits: [{ pane: 'w1:p1', agent: 'claude', title: 'api', role: 'assistant', offset: 3, ts: '', text: 'the deploy script', excerpt: 'Run the deploy script' }],
  limited: false,
}))

afterEach(() => { navigate.mockClear(); herdrState.value = { ok: false, workspaces: [], panes: [] }; coordinators.value = []; taskAgents.value = {} })

async function typed(w: Awaited<ReturnType<typeof mountSuspended>>, q: string) {
  await w.get('[data-slot=input] input').setValue(q)
  await new Promise(r => setTimeout(r, 320))
  await flushPromises()
}

it('opens the conversation of a hit on Enter, at the hit', async () => {
  herdrState.value = { ok: true, workspaces: [{ id: 'w1', label: 'api', number: 1, status: null, worktree: false }], panes: [{ id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '/repos/api', agentSession: null }] }
  const w = await mountSuspended(CommandMenu, { props: { open: true }, attachTo: document.body })
  await flushPromises()
  await typed(w, 'deploy script')
  await vi.waitFor(() => expect(w.text()).toContain('Run the deploy script'))
  const input = w.get('[data-slot=input] input')
  // The agent itself matches no text: the first option is the hit.
  await input.trigger('keydown', { key: 'Enter' })
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ path: '/a/w1%3Ap1', query: expect.objectContaining({ q: 'deploy script', hit: '3' }) })))
  w.unmount()
}, 60_000) // the file's first mount is slow when cold

it('finds a task by its title and a setting by its name', async () => {
  const w = await mountSuspended(CommandMenu, { props: { open: true } })
  await flushPromises()
  await typed(w, 'login')
  expect(w.text()).toContain('Fix the login banner')
  expect(w.text()).toContain('DEMO-7')
  await typed(w, 'typewriter')
  expect(w.text()).toContain('Conversation › Typewriter')
  await typed(w, 'autopilot')
  expect(w.text()).toContain('Demo app › Autopilot')
  w.unmount()
})

it('shows the colored key badge of a coordinator, a task agent and a task; none for a plain agent', async () => {
  const pane = (id: string, since: number, more: Partial<Pane> = {}): Pane => ({ id, coreAddress: id, workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: null, cwd: '~/project', agentSession: null, since, ...more })
  herdrState.value = { ok: true, workspaces: [{ id: 'w1', label: 'demo', number: 1, status: null, worktree: false }], panes: [pane('t1', 3), pane('t2', 2), pane('t3', 1, { name: 'plain' })] }
  coordinators.value = [{ project: 'DEMO', name: 'Demo app', color: 'blue', terminal: 't1' }]
  taskAgents.value = { t2: { task: 'DEMO-7', shown: 'DEMO-7', title: 'Fix the login banner', role: 'dev' } }
  const w = await mountSuspended(CommandMenu, { props: { open: true } })
  await flushPromises()
  const titles = w.findAll('.global-search-agent-title')
  expect(titles.map(t => t.find('[data-testid="project-badge"]').exists() ? t.find('[data-testid="project-badge"]').text() : '')).toEqual(['DEMO', 'DEMO-7', ''])
  expect(titles[0]!.find('[data-testid="project-badge"]').attributes('style')).toContain('--project-blue')
  // The task agent's title leaves out the key its badge shows.
  expect(titles[1]!.text()).toBe('DEMO-7Fix the login banner')
  await typed(w, 'login')
  const task = w.findAll('[data-slot=item]').find(i => i.text().includes('Fix the login banner') && !i.find('.global-search-agent-title').exists())!
  expect(task.find('[data-testid="project-badge"]').text()).toBe('DEMO-7')
  w.unmount()
})
