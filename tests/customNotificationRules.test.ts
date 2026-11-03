import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HerdrNotification } from '../server/utils/herdrEndpoint'
import type { Machine } from '../server/utils/machines'

const deps = vi.hoisted(() => ({ allowed: vi.fn(), pushSend: vi.fn(), findPane: vi.fn() }))
vi.mock('../server/utils/notificationRules', () => ({ notificationAllowed: deps.allowed }))
vi.mock('../server/utils/push', () => ({ pushSend: deps.pushSend, subWatchesSession: () => true }))
vi.mock('../server/utils/state', () => ({ findPane: deps.findPane, getState: () => ({ workspaces: [] }) }))
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
  it('ignores Herdr state notices already delivered by state transitions', async () => {
    await onNotice(machine, { ...notice('Example done'), kind: 'finished' })
    expect(deps.pushSend).not.toHaveBeenCalled()
  })
})
