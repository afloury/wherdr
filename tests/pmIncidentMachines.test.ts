import { describe, expect, it } from 'vitest'
import { machineFacts, type IncidentDeps } from '../server/utils/pmIncidents'
import { diagnose } from '../shared/pm/incident'

const NOW = Date.parse('2026-01-10T12:00:00Z')
const deps = (status: 'online' | 'offline') => ({
  call: async () => ({}),
  machines: () => [{ key: 'b', label: 'host-b', local: false, status, error: status === 'offline' ? 'ssh: connection timed out' : null }],
}) as unknown as IncidentDeps

describe('machineFacts: a machine wherdr cannot reach', () => {
  it('terminal not found while the ssh check failed: offline, not unknown', async () => {
    const list = { terminals: [], machines: [{ name: 'host-b', state: 'connected' }] }
    const gone = [{ run: { id: '1', task: 'WEB-1', role: 'worker', program: 'claude', machine: 'b', startedAt: NOW - 3_600_000 } }]
    const [i] = diagnose(gone, await machineFacts(deps('offline'), list, NOW), () => null, NOW)
    expect(i).toMatchObject({ cause: 'offline', label: 'host-b' })
    expect(i!.evidence[0]).toMatch(/connection timed out/)
  })
})
