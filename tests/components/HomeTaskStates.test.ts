// WHR-52: a task's agent rows take the task's state in the sidebar, as on the
// board: Blocked or Your turn, and the header counts them.
import { afterEach, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import HomeView from '~/components/HomeView.vue'
import { desk, eventsOpen, herdrState, homeGrouping } from '~/composables/useHerdr'
import type { AgentTask } from '#shared/pm/blocked'
import type { Pane } from '#shared/types'

registerEndpoint('/api/pm/overview', () => ({ enabled: true, projects: [], templates: [] }))
registerEndpoint('/api/pm/coordinators', () => [])
registerEndpoint('/api/pm/agents', (): AgentTask[] => [
  { id: 'CO-1', holder: 'none', terminals: ['t1'], blocked: 'Merge refused: head moved' },
  { id: 'CO-2', holder: 'none', terminals: ['t2'], yourTurn: 'Look at the screenshots, then merge' },
])

const pane = (n: number, status: Pane['status']): Pane => ({
  id: `w${n}:p1`, coreAddress: `t${n}`, workspace: `w${n}`, tab: `w${n}:t1`, tabLabel: null, agent: 'claude', name: null, label: null,
  status, title: `Agent ${n}`, cwd: '~/project', agentSession: null,
})
afterEach(() => { herdrState.value = { ok: false, workspaces: [], panes: [] }; eventsOpen.value = false; desk.value = false })

it('the worker of a blocked task lists in Blocked, a task waiting for the user in Your turn, and the counters follow', async () => {
  homeGrouping.value = 'machine'
  desk.value = true // the list is shown: it reads the tasks
  // Both agents ended their turn; a third one with no task stays Ready.
  const panes = [pane(1, 'done'), pane(2, 'working'), pane(3, 'idle')]
  herdrState.value = { ok: true, panes, workspaces: panes.map((p, i) => ({ id: p.workspace, number: i + 1, label: `s${i}`, focused: false })) } as never
  eventsOpen.value = true
  const w = await mountSuspended(HomeView, { global: { stubs: { UDropdownMenu: true, UContextMenu: { template: '<div><slot /></div>' }, UTooltip: { template: '<div><slot /></div>' } } } })
  const group = (key: string) => w.findAll(`.agent-group.${key} [data-pane]`).map(c => c.attributes('data-pane'))
  await expect.poll(() => group('stuck')).toEqual(['w1:p1'])
  expect(group('blocked')).toEqual(['w2:p1'])
  expect(group('ready')).toEqual(['w3:p1'])
  expect(w.find('.agent-group.stuck .group-title').text()).toContain('Blocked')
  expect(w.find('[data-pane="w1:p1"] .card-state').attributes('title')).toBe('Blocked: Merge refused: head moved')
  expect(w.find('[data-pane="w2:p1"] .card-state').classes()).toContain('blocked')
  const stat = (s: string) => w.find(`.stats .stat.${s} b`).text()
  expect([stat('blocked'), stat('stuck'), stat('working'), stat('done')]).toEqual(['1', '1', '0', '1'])
  w.unmount()
})
