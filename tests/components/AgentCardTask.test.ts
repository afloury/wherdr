import { afterEach, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AgentCard from '~/components/AgentCard.vue'
import { herdrState } from '~/composables/useHerdr'
import { taskAgents, taskAgentsNow } from '~/composables/useTaskAgents'
import type { Pane } from '#shared/types'

const pane: Pane = { id: 'w1:p1', coreAddress: 't1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: 'CO-1 task instructions', cwd: '~/project', agentSession: null, since: 0 }
const row = { kind: 'pane', key: pane.id, pane, lead: pane, individual: true } as const
afterEach(() => {
  taskAgents.value = {}
  herdrState.value = { ok: false, panes: [], workspaces: [] }
})

it('a task agent\'s row: its task title, role badge and duration; a reviewer in reserve is dimmed', async () => {
  herdrState.value = { ok: true, panes: [pane], workspaces: [] }
  taskAgentsNow.value = 8 * 60_000
  taskAgents.value = { t1: { task: 'CO-1', shown: 'AC-1', title: 'Fix the login', role: 'review', reserve: true } }
  const w = await mountSuspended(AgentCard, { props: { pane, row } })
  try {
    expect(w.find('.card-title').text()).toBe('AC-1 Fix the login')
    expect(w.find('[data-testid="agent-role"]').text()).toBe('review')
    expect(w.find('.card-age').text()).toBe('8 min')
    // Dimmed only: its herdr-core status stays.
    expect(w.find('.card').classes()).toEqual(expect.arrayContaining(['task-reserve', 'idle']))
    // A pane the user renamed keeps its name; the badge stays.
    await w.setProps({ pane: { ...pane, label: 'Mine' } })
    expect(w.find('.card-title').text()).toBe('Mine')
    taskAgents.value = {}
    await w.vm.$nextTick()
    expect(w.find('[data-testid="agent-role"]').exists()).toBe(false)
    expect(w.find('.card-age').exists()).toBe(false)
  } finally { w.unmount() }
})
