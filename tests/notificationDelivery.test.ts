import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultNotifications, type NotificationSettings } from '../shared/notificationRules'

const deps = vi.hoisted(() => ({ readSettings: vi.fn(), readBoardLinks: vi.fn(), pushSend: vi.fn(), allowed: vi.fn(), findPane: vi.fn() }))
vi.mock('../server/utils/settings', () => ({ readSettings: deps.readSettings }))
vi.mock('../server/utils/boardLinks', () => ({ readBoardLinks: deps.readBoardLinks }))
vi.mock('../server/utils/machines', () => ({ getMachine: () => undefined, machineOfPane: () => undefined,
  allMachines: () => [], multiMachine: () => false, onMachinesChange: () => {} }))

import { notificationAllowed, notificationPresence } from '../server/utils/notificationRules'

let policy: NotificationSettings
beforeEach(() => {
  policy = defaultNotifications()
  deps.readSettings.mockImplementation(async () => ({ notificationRules: JSON.stringify(policy) }))
  deps.readBoardLinks.mockResolvedValue({ version: '1', machines: [] })
})

describe('server notification gate', () => {
  it('reads the shared policy anew after a device changes it', async () => {
    policy.default.events = []
    const source = { machine: '', conversation: 'w1:p1' }
    expect(await notificationAllowed('needs-you', { workspaces: [] }, undefined, source)).toBe(false)
    policy.exceptions.push({ kind: 'conversation', machine: '', id: 'w1:p1', label: 'Example', events: ['needs-you'], subagents: false, until: null })
    expect(await notificationAllowed('needs-you', { workspaces: [] }, undefined, source)).toBe(true)
    expect(await notificationAllowed('finished', { workspaces: [] }, undefined, source)).toBe(false)
  })
  it('follows a coordinator exception by identity and keeps linked helpers silent by default', async () => {
    policy.default.events = []
    policy.exceptions.push({ kind: 'coordinator', machine: '', id: 'default/top/', label: 'Coordinator', events: ['finished'], subagents: false, until: null })
    deps.readBoardLinks.mockResolvedValue({ version: '1', machines: [{ machine: '',
      coordinators: [{ pane: 'w1:p9', level: 'top', session: 'default' }], tasks: [{ panes: [{ id: 'w2:p1' }], repo: 'example' }],
    }] })
    expect(await notificationAllowed('finished', { workspaces: [] }, { id: 'w1:p9', workspace: 'w1' })).toBe(true)
    expect(await notificationAllowed('finished', { workspaces: [] }, { id: 'w2:p1', workspace: 'w2' })).toBe(false)
  })
  it('lets a board event through with sub-agents off, but not a task agent’s own message', async () => {
    deps.readBoardLinks.mockResolvedValue({ version: '1', machines: [{ machine: '', coordinators: [], tasks: [{ panes: [{ id: 'w2:p1' }], repo: 'example' }] }] })
    const p = { id: 'w2:p1', workspace: 'w2' }
    expect(await notificationAllowed('needs-you', { workspaces: [] }, p, { machine: '', project: 'example', board: true })).toBe(true)
    expect(await notificationAllowed('needs-you', { workspaces: [] }, p)).toBe(false)
  })
  it('suppresses an enabled conversation for all recipients while another device views it', async () => {
    policy.default.events = ['message']
    const source = { machine: '', conversation: 'w3:p1' }
    notificationPresence.heartbeat('desktop', source.conversation, true)
    expect(await notificationAllowed('message', { workspaces: [] }, undefined, source)).toBe(false)
    // An expired lease permits push without the browser ever disconnecting.
    notificationPresence.heartbeat('desktop', source.conversation, true, Date.now() - 30000)
    expect(await notificationAllowed('message', { workspaces: [] }, undefined, source)).toBe(true)
  })
  it('applies the default to unscoped custom and scheduled notices', async () => {
    policy.default.events = ['scheduled']
    expect(await notificationAllowed('message', { workspaces: [] }, undefined, { machine: '' })).toBe(false)
    expect(await notificationAllowed('scheduled', { workspaces: [] }, undefined, { machine: '' })).toBe(true)
  })
})
