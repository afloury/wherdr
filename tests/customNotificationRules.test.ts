import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HerdrNotification } from '../server/utils/herdrEndpoint'
import type { Machine } from '../server/utils/machines'

const deps = vi.hoisted(() => ({ allowed: vi.fn(), pushSend: vi.fn(), findPane: vi.fn(), links: vi.fn() }))
vi.mock('../server/utils/notificationRules', () => ({ notificationAllowed: deps.allowed }))
vi.mock('../server/utils/push', () => ({ pushSend: deps.pushSend, subWatchesSession: () => true }))
vi.mock('../server/utils/state', () => ({ findPane: deps.findPane, getState: () => ({ workspaces: [] }) }))
vi.mock('../server/utils/boardLinks', () => ({ readBoardLinks: deps.links }))
vi.mock('../server/utils/projectsTasks', () => ({ boardMachine: (m: Machine) => m, repoKeyOf: () => 'APP' }))
vi.mock('../server/utils/machines', () => ({ allMachines: () => [], multiMachine: () => false, onMachinesChange: () => {} }))
vi.mock('../server/utils/env', () => ({ NOTICES_ENABLED: false, log: () => {} }))

import { onNotice } from '../server/utils/herdrNotify'
const machine = { key: '', session: 'default', info: () => ({ baseKey: '' }) } as Machine
const notice = (title: string, paneId: string | null = null): HerdrNotification => ({ title, kind: 'custom', body: 'Example notice', sound: null, paneId, tabId: null, workspaceId: null, agent: null })
beforeEach(() => {
  vi.clearAllMocks()
  deps.allowed.mockResolvedValue(true)
  deps.pushSend.mockResolvedValue(1)
  deps.findPane.mockReturnValue(undefined)
  deps.links.mockResolvedValue({ machines: [] })
})
describe('custom notice delivery', () => {
  it('gates ordinary custom notices as new messages and keeps deduplication', async () => {
    const n = notice('Example custom')
    await onNotice(machine, n)
    await onNotice(machine, n)
    expect(deps.allowed).toHaveBeenCalledWith('message', expect.anything(), undefined, expect.objectContaining({ machine: '' }))
    expect(deps.pushSend).toHaveBeenCalledTimes(1)
  })
  it('gates marked scheduled notices separately', async () => {
    await onNotice(machine, notice('[scheduled] Example routine'))
    expect(deps.allowed).toHaveBeenCalledWith('scheduled', expect.anything(), undefined, expect.anything())
  })
  it('does not push muted notices', async () => {
    deps.allowed.mockResolvedValue(false)
    await onNotice(machine, notice('Example muted'))
    expect(deps.pushSend).not.toHaveBeenCalled()
  })
  it('resolves board approval notices to their manually enabled conversation', async () => {
    const p = { id: 'w2:p1', workspace: 'w2' }
    deps.links.mockResolvedValue({ machines: [{ machine: '', tasks: [{ id: 'example/1', panes: [{ id: p.id }] }] }] })
    deps.findPane.mockReturnValue(p)
    await onNotice(machine, notice('example/1 · ready to approve'))
    expect(deps.allowed).toHaveBeenCalledWith('needs-you', expect.anything(), p, expect.objectContaining({ subagent: true, project: 'example' }))
  })
  it('does not let a board hook borrow its calling coordinator notification rules', async () => {
    const worker = { id: 'w2:p1', workspace: 'w2' }
    const coordinator = { id: 'w1:p1', workspace: 'w1' }
    deps.findPane.mockImplementation(id => id === worker.id ? worker : coordinator)
    deps.links.mockResolvedValue({ machines: [{ machine: '', tasks: [{ id: 'example/2', panes: [{ id: worker.id }] }] }] })
    await onNotice(machine, notice('example/2 · needs you', coordinator.id))
    expect(deps.allowed).toHaveBeenCalledWith('needs-you', expect.anything(), worker, expect.objectContaining({ subagent: true }))
  })
  it('ignores Herdr state notices already delivered by state transitions', async () => {
    await onNotice(machine, { ...notice('Example done'), kind: 'finished' })
    expect(deps.pushSend).not.toHaveBeenCalled()
  })
})
