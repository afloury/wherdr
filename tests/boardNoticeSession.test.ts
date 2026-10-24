// A board notice for a task of another Herdr session, with no pane or space
// linked: its session is unknown, so no coordinator exception may decide it.
import { beforeEach, expect, it, vi } from 'vitest'
import type { HerdrNotification } from '../server/utils/herdrEndpoint'
import type { Machine } from '../server/utils/machines'
import { coordinatorFromFile, linksFromTaskFile, socketSession, tasksFromFiles, type FileLinks } from '../shared/boardLinks'
import { defaultNotifications, type NotificationSettings } from '../shared/notificationRules'

const deps = vi.hoisted(() => ({ readSettings: vi.fn(), readBoardLinks: vi.fn(), pushSend: vi.fn() }))
vi.mock('../server/utils/settings', () => ({ readSettings: deps.readSettings }))
vi.mock('../server/utils/boardLinks', () => ({ readBoardLinks: deps.readBoardLinks }))
vi.mock('../server/utils/push', () => ({ pushSend: deps.pushSend, subWatchesSession: () => true }))
vi.mock('../server/utils/state', () => ({ findPane: () => undefined, getState: () => ({ workspaces: [] }) }))
vi.mock('../server/utils/projectsTasks', () => ({ boardMachine: (m: Machine) => m, repoKeyOf: () => 'SHOP' }))
vi.mock('../server/utils/machines', () => ({ allMachines: () => [], multiMachine: () => false, onMachinesChange: () => {},
  getMachine: () => undefined, machineOfPane: () => undefined }))
vi.mock('../server/utils/env', () => ({ NOTICES_ENABLED: false, log: () => {} }))

import { onNotice } from '../server/utils/herdrNotify'

const machine = { key: '', session: 'default', info: () => ({ baseKey: '' }) } as Machine
const name = (s: unknown) => socketSession(s, 'default')
const key = (s: unknown) => (s ? 'abcd' : '')
let policy: NotificationSettings
let n = 0
const notice = (id: string): HerdrNotification => ({ title: `${id} · needs you`, kind: 'custom', body: `Example ${++n}`, sound: null, paneId: null, tabId: null, workspaceId: null, agent: null })
beforeEach(() => {
  vi.clearAllMocks()
  deps.pushSend.mockResolvedValue(1)
  policy = defaultNotifications()
  deps.readSettings.mockImplementation(async () => ({ notificationRules: JSON.stringify(policy) }))
  const files = [
    linksFromTaskFile({ id: 'shop/1', link: { pane: 'w2:p1' } }, key, name),
    // Session `other` (no coordinator there), nothing linked: left out of the links.
    linksFromTaskFile({ id: 'shop/2', link: { socket: '/run/sessions/other/herdr.sock' } }, key, name),
  ].filter((f): f is FileLinks => f !== null)
  deps.readBoardLinks.mockResolvedValue({ version: '1', machines: [{ machine: '',
    coordinators: [coordinatorFromFile('project', { pane: 'w1:p2' }, key, 'shop', 'default')!], tasks: tasksFromFiles(files, {}) }] })
})
const exception = (events: NotificationSettings['default']['events']) =>
  ({ kind: 'coordinator' as const, machine: '', id: 'default/project/shop', label: 'shop', events, subagents: false, until: null })

it('default muted + the default session’s project exception: the other session’s task stays muted', async () => {
  policy.default.events = []
  policy.exceptions.push(exception(['needs-you']))
  await onNotice(machine, notice('shop/2'))
  expect(deps.pushSend).not.toHaveBeenCalled()
  // Its own session's task, linked, follows the exception.
  await onNotice(machine, notice('shop/1'))
  expect(deps.pushSend).toHaveBeenCalledTimes(1)
})

it('default on + the default session’s project exception muted: the other session’s task still notifies', async () => {
  policy.default.events = ['needs-you']
  policy.exceptions.push(exception([]))
  await onNotice(machine, notice('shop/2'))
  expect(deps.pushSend).toHaveBeenCalledTimes(1)
  await onNotice(machine, notice('shop/1'))
  expect(deps.pushSend).toHaveBeenCalledTimes(1)
})
