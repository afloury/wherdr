import { describe, expect, it } from 'vitest'
import { coreState } from '../shared/coreState'
import type { CoreTerminal } from '../shared/coreInventory'
const terminal = (address: string, extra = {}): CoreTerminal => ({ address, cwd: '/workspace/demo', state: 'live', ...extra })
describe('core state for the existing interface', () => {
  it('groups a cwd on its machine, preserves addresses and stable navigation IDs', () => {
    const terminals = [terminal('t1'), terminal('t2', { template: 'codex', status: { state: 'working' } }), terminal('host-a/t1')]
    const state = coreState(terminals, [{ name: 'host-a', state: 'connected' }])
    expect(state.workspaces).toHaveLength(2)
    expect(state.tabs).toHaveLength(3)
    expect(state.panes.map(p => [p.coreAddress, p.agent, p.status])).toEqual([
      ['t1', null, 'unknown'], ['t2', 'codex', 'working'], ['host-a/t1', null, 'unknown'],
    ])
    expect(coreState([...terminals].reverse(), []).panes.map(p => p.id).reverse()).toEqual(state.panes.map(p => p.id))
    expect(state.machines?.[1]?.status).toBe('online')
  })
  it('keeps a disconnected machine distinct from an agent status', () => {
    const state = coreState([terminal('host-a/t1', { status: { state: 'error', app: 'claude-code' } })], [{ name: 'host-a', state: 'unreachable' }])
    expect(state.panes[0]).toMatchObject({ agent: 'claude', status: 'blocked' })
    expect(state.machines?.[1]?.status).toBe('offline')
  })
})
