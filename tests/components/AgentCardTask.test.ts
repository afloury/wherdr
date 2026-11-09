import { afterEach, expect, it, vi } from 'vitest'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import AgentCard from '~/components/AgentCard.vue'
import { herdrState } from '~/composables/useHerdr'
import { taskAgents, taskAgentsNow } from '~/composables/useTaskAgents'
import type { Pane } from '#shared/types'

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))
mockNuxtImport('navigateTo', () => navigate)

const pane: Pane = { id: 'w1:p1', coreAddress: 't1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'idle', title: 'CO-1 task instructions', cwd: '~/project', agentSession: null, since: 0, preview: 'Looks good' }
const row = { kind: 'pane', key: pane.id, pane, lead: pane, individual: true } as const
afterEach(() => {
  taskAgents.value = {}
  herdrState.value = { ok: false, panes: [], workspaces: [] }
})

it('a task agent\'s row: state, key badge, task title and duration, then role · machine · last message; a reviewer in reserve is dimmed', async () => {
  herdrState.value = { ok: true, panes: [pane], workspaces: [] }
  taskAgentsNow.value = 8 * 60_000
  taskAgents.value = { t1: { task: 'CO-1', shown: 'AC-1', title: 'Fix the login', role: 'review', reserve: true } }
  const w = await mountSuspended(AgentCard, { props: { pane, row, machineBadge: 'laptop' } })
  try {
    // The state square leads the row; a Claude agent shows no icon.
    expect(w.find('.card').element.firstElementChild?.classList.contains('card-state')).toBe(true)
    expect(w.find('.avatar').exists()).toBe(false)
    expect(w.find('[data-testid="project-badge"]').text()).toBe('AC-1')
    expect(w.find('.card-title').text()).toBe('Fix the login')
    expect(w.find('.card-age').text()).toBe('8 min')
    expect(w.find('.card-origin').exists()).toBe(false)
    expect(w.find('[data-testid="task-agent-line"]').text()).toBe('review · laptop · Looks good')
    // Dimmed only: its herdr-core status stays.
    expect(w.find('.card').classes()).toEqual(expect.arrayContaining(['task-reserve', 'idle']))
    // A pane the user renamed keeps its name; the badge stays.
    await w.setProps({ pane: { ...pane, label: 'Mine' } })
    expect(w.find('.card-title').text()).toBe('Mine')
    taskAgents.value = {}
    await w.vm.$nextTick()
    expect(w.find('[data-testid="agent-role"]').exists()).toBe(false)
    expect(w.find('[data-testid="task-agent-line"]').exists()).toBe(false)
    expect(w.find('.card-age').exists()).toBe(false)
    // After a restart: a new address and run, the same task and role labels: still the task's row.
    taskAgents.value = { 'CO-1#reviewer': { task: 'CO-1', shown: 'AC-1', title: 'Fix the login', role: 'review' } }
    await w.setProps({ pane: { ...pane, coreAddress: 't9', task: 'CO-1', role: 'reviewer' } })
    expect(w.find('[data-testid="project-badge"]').text()).toBe('AC-1')
    expect(w.find('.card-title').text()).toBe('Fix the login')
    expect(w.find('[data-testid="task-agent-line"]').text()).toBe('review · laptop · Looks good')
  } finally { w.unmount() }
})

it('several agents of a task: one title line, then a line per agent that opens it', async () => {
  const reviewer: Pane = { ...pane, id: 'w1:p2', coreAddress: 't2', agent: 'codex', status: 'working', preview: 'Reading the diff' }
  herdrState.value = { ok: true, panes: [pane, reviewer], workspaces: [] }
  taskAgents.value = {
    t1: { task: 'CO-1', shown: 'AC-1', title: 'Fix the login', role: 'fix' },
    t2: { task: 'CO-1', shown: 'AC-1', title: 'Fix the login', role: 'review' },
  }
  const lead = { ...row, key: reviewer.id, pane: reviewer, lead: reviewer }
  const w = await mountSuspended(AgentCard, { props: { pane: reviewer, row: lead, agents: [{ pane }, { pane: reviewer }] } })
  try {
    expect(w.findAll('.card-title')).toHaveLength(1)
    const lines = w.findAll('[data-testid="task-agent-line"]')
    expect(lines.map(l => l.text())).toEqual(['fix · Looks good', 'review · Reading the diff'])
    // Each line has its own state; a non-Claude agent keeps a small icon.
    expect(lines.map(l => l.find('.card-state').classes())).toEqual([expect.arrayContaining(['idle']), expect.arrayContaining(['working'])])
    expect(lines[0]!.find('.avatar').exists()).toBe(false)
    expect(lines[1]!.find('.avatar').exists()).toBe(true)
    // Each line opens its own agent, not the row's lead.
    await lines[0]!.trigger('click')
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(`/a/${encodeURIComponent(pane.id)}`)
  } finally { w.unmount() }
})
