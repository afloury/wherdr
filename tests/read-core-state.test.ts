import { afterEach, expect, it, vi } from 'vitest'
import { coreCall } from '../server/utils/core'
import { readCoreState } from '../server/utils/readCoreState'
vi.mock('../server/utils/core', () => ({ coreCall: vi.fn() }))
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
import { clearCoreDocs } from '../server/utils/readCoreDocs'
afterEach(clearCoreDocs)
it('reads core machines and terminals without legacy discovery', async () => {
  vi.stubEnv('HC_SOCKET', '/test/core.sock')
  vi.mocked(coreCall).mockImplementation(async (_endpoint, method) => method === 'terminal.list'
    ? { terminals: [{ address: 't1', cwd: '/workspace/demo', state: 'live' }] } : { machines: [] })
  const state = await readCoreState({ ok: false, panes: [], workspaces: [] })
  expect(state.ok).toBe(true)
  expect(state.panes[0]?.status).toBe('unknown')
  expect(vi.mocked(coreCall).mock.calls.map(c => c[1])).toEqual(['terminal.list', 'machine.list', 'doc.get'])
  vi.mocked(coreCall).mockRejectedValue(new Error('Disconnected'))
  const offline = await readCoreState(state)
  expect(offline.ok).toBe(false)
  expect(offline.panes).toEqual(state.panes)
  expect(offline.machines?.[0]?.status).toBe('offline')
})

it('rereads core machines at once after staleCoreDocs (forget/rename)', async () => {
  vi.stubEnv('HC_SOCKET', '/test/core.sock')
  const { useCoreSession, staleCoreDocs } = await import('../server/utils/readCoreState')
  useCoreSession({ snapshot: () => [] } as never)
  let machines = [{ name: 'host-a', status: 'online' }]
  vi.mocked(coreCall).mockImplementation(async (_e, method) => method === 'machine.list' ? { machines } : { terminals: [] })
  const prev = { ok: true, panes: [], workspaces: [] }
  await readCoreState(prev)
  machines = []
  const cached = vi.mocked(coreCall).mock.calls.length
  await readCoreState(prev)
  expect(vi.mocked(coreCall).mock.calls.length).toBe(cached) // still cached
  staleCoreDocs()
  await readCoreState(prev)
  expect(vi.mocked(coreCall).mock.calls.slice(cached).map(c => c[1])).toContain('machine.list')
  useCoreSession(null)
})
