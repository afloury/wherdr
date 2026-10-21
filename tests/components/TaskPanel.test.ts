import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'
import BoardPanel from '~/components/BoardPanel.vue'
import { herdrState } from '~/composables/useHerdr'
import { parseTaskDetails, parseTaskRow } from '#shared/projectsTasks'

const decision = vi.hoisted(() => ({ yes: true }))
mockNuxtImport('askConfirm', () => async () => decision.yes)

let failure: Record<string, unknown> = {}
let pane: string | null = 'w1:p1'
let stage = 'failed'
const calls: unknown[] = []
registerEndpoint('/api/tasks/details', () => ({ ...parseTaskDetails(JSON.stringify({ task: { id: 'demo/9', title: 'Improve search', stage, description: 'Search by title' }, failure, summary: 'Search tested.' })), pane }))
registerEndpoint('/api/tasks/action', { method: 'POST', handler: async event => { calls.push(await readBody(event)); return { ok: true } } })
registerEndpoint('/api/tasks/approve', { method: 'POST', handler: async event => { calls.push(await readBody(event)); return { ok: true } } })
const row = () => parseTaskRow({ id: 'demo/9', title: 'Improve search', stage, state: 'error', app: 'claude' })!
async function panel(extra = {}, agent: string | null = null) {
  herdrState.value = { ok: true, workspaces: [], panes: [{ id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent, name: null, label: null, status: 'idle', title: null, cwd: '/tmp/demo', agentSession: null }] }
  const w = await mountSuspended(BoardPanel, { props: { target: { kind: 'task', machine: '', id: 'demo/9' }, task: row(), machineLabel: 'devbox', reachable: true, ...extra }, global: { stubs: { AgentView: { props: ['selectedMode'], template: '<div class="embedded-agent">{{ selectedMode }}</div>' }, TaskSheet: { template: '<div class="task-content">Search by title</div>' } } } })
  await flushPromises()
  return w
}
afterEach(() => { failure = {}; pane = 'w1:p1'; stage = 'failed'; calls.length = 0; decision.yes = true; herdrState.value = { ok: false, workspaces: [], panes: [] } })

describe('task panel', () => {
  it('explains setup failure instead of opening a bare shell', async () => {
    failure = { stage: 'setup', title: 'Setup failed', detail: 'npm ci\nLockfile missing', next: 'Restore the lockfile.', agentCanFix: false }
    const w = await panel()
    expect(w.find('.board-panel-name').text()).toContain('Improve search')
    expect(w.find('.task-needs').text()).toContain('Lockfile missing')
    expect(w.find('.task-needs').text()).toContain('Restore the lockfile.')
    expect(w.find('.embedded-agent').exists()).toBe(false)
    expect(w.find('.task-setup').text()).toContain('Setup output')
    expect(w.emitted('noAgent')).toBeUndefined()
    const start = w.findAll('.task-needs button').find(b => b.text() === 'Start again')!
    await start.trigger('click'); await flushPromises()
    expect(calls).toContainEqual({ machine: '', id: 'demo/9', action: 'delegate' })
    await w.findAll('.board-panel-tabs button')[1]!.trigger('click')
    expect(w.find('.embedded-agent').text()).toBe('term')
    w.unmount()
  })
  it('uses separate retry and fix commands for an agent failure', async () => {
    failure = { stage: 'agent', title: 'Tests failed', detail: 'npm test exited 1', agentCanFix: true }
    const w = await panel()
    for (const [label, action] of [['Retry', 'retry'], ['Send the error to the agent', 'fix']]) {
      const button = () => w.findAll('.task-needs button').find(b => b.text() === label)!
      await vi.waitFor(() => expect(button().attributes('disabled')).toBeUndefined())
      await button().trigger('click')
      await vi.waitFor(() => expect(calls).toContainEqual({ machine: '', id: 'demo/9', action }))
    }
    w.unmount()
  })
  it('keeps a task with no pane open and puts the description in Task', async () => {
    pane = null
    failure = { stage: 'setup', title: 'Setup failed', detail: 'Install failed' }
    const w = await panel()
    expect(w.emitted('noAgent')).toBeUndefined()
    // Nothing to talk to: straight to Task, the other tabs hidden.
    expect(w.findAll('.board-panel-tabs button').map(b => b.text())).toEqual(['Task'])
    expect(w.find('.task-content').text()).toContain('Search by title')
    expect(w.find('.task-new').exists()).toBe(false)
    expect(w.find('.task-setup').exists()).toBe(false)
    expect(w.find('.task-needs').text()).toContain('Install failed')
    w.unmount()
  })
  it('opens a task never started on Task, then on Conversation once its agent starts', async () => {
    pane = null
    stage = 'todo'
    const todo = { ...row(), stage: 'todo', state: 'idle', app: '', group: 'todo' as const }
    const w = await panel({ task: todo, target: { kind: 'task', machine: '', id: `demo/9-${Math.random()}` } }, 'claude')
    expect(w.findAll('.board-panel-tabs button').map(b => b.text())).toEqual(['Task'])
    expect(w.find('.task-content').exists()).toBe(true)
    expect(w.text()).not.toContain('No agent conversation yet')
    // Its agent starts: Conversation is back and shown.
    pane = 'w1:p1'
    stage = 'working'
    await w.setProps({ task: { ...todo, stage: 'working', state: 'working', app: 'claude', group: 'working' } })
    await vi.waitFor(() => expect(w.findAll('.board-panel-tabs button').map(b => b.text())).toEqual(['Conversation', 'Terminal', 'Task']))
    expect(w.find('.embedded-agent').text()).toBe('chat')
    w.unmount()
  })
  it('keeps a tab picked by hand while it is offered, also when the panel opens again', async () => {
    stage = 'working'
    const id = `demo/9-${Math.random()}`
    const task = { ...row(), stage: 'working', state: 'working', group: 'working' as const }
    const w = await panel({ task, target: { kind: 'task', machine: '', id } }, 'claude')
    expect(w.find('.embedded-agent').text()).toBe('chat')
    await w.findAll('.board-panel-tabs button')[2]!.trigger('click')
    expect(w.find('.task-content').exists()).toBe(true)
    // Reloaded details keep the choice.
    await w.setProps({ task: { ...task, msg: 'moved on' } })
    await flushPromises()
    await new Promise(r => setTimeout(r, 50))
    expect(w.find('.task-content').exists()).toBe(true)
    w.unmount()
    const again = await panel({ task, target: { kind: 'task', machine: '', id } }, 'claude')
    expect(again.find('.task-content').exists()).toBe(true)
    expect(again.find('.board-panel-tabs button.on').text()).toBe('Task')
    // Terminal picked, then its pane is gone: the choice is dropped.
    await again.findAll('.board-panel-tabs button')[1]!.trigger('click')
    expect(again.find('.embedded-agent').text()).toBe('term')
    pane = null
    await again.setProps({ task: { ...task, msg: 'stopped' } })
    await vi.waitFor(() => expect(again.findAll('.board-panel-tabs button').map(b => b.text())).toEqual(['Conversation', 'Task']))
    // Its reply field (tell) is the default view again, not the terminal.
    expect(again.find('#board-panel-tell').exists()).toBe(true)
    again.unmount()
    pane = 'w1:p1'
    const third = await panel({ task, target: { kind: 'task', machine: '', id } }, 'claude')
    expect(third.find('.embedded-agent').text()).toBe('chat')
    third.unmount()
  })
  it('keeps Conversation for a reply passed on when the agent has no pane', async () => {
    pane = null
    stage = 'working'
    const task = { ...row(), stage: 'working', state: 'working', group: 'working' as const }
    const w = await panel({ task, target: { kind: 'task', machine: '', id: `demo/9-${Math.random()}` } })
    expect(w.findAll('.board-panel-tabs button').map(b => b.text())).toEqual(['Conversation', 'Task'])
    expect(w.find('#board-panel-tell').exists()).toBe(true)
    w.unmount()
  })
  it('disables writes while unreachable or read-only and never offers fix for authentication', async () => {
    failure = { stage: 'agent', title: 'Needs login', auth: true, agentCanFix: false }
    const w = await panel({ reachable: false, readOnly: true })
    expect(w.find('.task-needs').text()).not.toContain('Send the error to the agent')
    expect(w.findAll('.task-needs button').every(b => b.attributes('disabled') !== undefined)).toBe(true)
    expect(calls).toHaveLength(0)
    w.unmount()
  })
  it('requires confirmation before an explicit approval override', async () => {
    stage = 'approval'
    const task = { ...row(), group: 'needs' as const, state: 'blocked', kind: 'permission', review: { pass: false, tally: '1 major', by: 'codex' } }
    const w = await panel({ task })
    const approve = w.findAll('.task-needs button').find(b => b.text() === 'Approve anyway')!
    decision.yes = false
    await approve.trigger('click'); await flushPromises()
    expect(calls).toHaveLength(0)
    decision.yes = true
    await approve.trigger('click'); await flushPromises()
    await vi.waitFor(() => expect(calls).toContainEqual({ machine: '', id: 'demo/9', anyway: true }))
    w.unmount()
  })
  it('shows a blocked question in the banner and no banner once done', async () => {
    const task = { ...row(), stage: 'asks', state: 'blocked', kind: 'question', msg: 'Which search fields?', group: 'needs' as const }
    const w = await panel({ task })
    expect(w.find('.task-needs').text()).toContain('Which search fields?')
    await w.setProps({ task: { ...task, stage: 'done', state: 'done', group: 'done' } })
    expect(w.find('.task-needs').exists()).toBe(false)
    w.unmount()
  })

})
