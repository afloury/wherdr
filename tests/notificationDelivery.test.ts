import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultNotifications, type NotificationSettings } from '../shared/notificationRules'

const deps = vi.hoisted(() => ({ readSettings: vi.fn(), pushSend: vi.fn(), allowed: vi.fn(), findPane: vi.fn() }))
vi.mock('../server/utils/settings', () => ({ readSettings: deps.readSettings }))
vi.mock('../server/utils/machines', () => ({ getMachine: () => undefined, machineOfPane: () => undefined,
  allMachines: () => [], multiMachine: () => false, onMachinesChange: () => {} }))

import { notificationAllowed, notificationPresence } from '../server/utils/notificationRules'

let policy: NotificationSettings
beforeEach(() => {
  policy = defaultNotifications()
  deps.readSettings.mockImplementation(async () => ({ notificationRules: JSON.stringify(policy) }))
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
