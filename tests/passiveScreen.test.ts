import { describe, expect, it, vi } from 'vitest'
import { readPassiveScreen } from '../server/utils/passiveScreen'
import { createSelfUpdates } from '../server/utils/agentSelfUpdate'
import type { Pane } from '../shared/types'

// Model the observable Herdr behavior: history harvesting navigates the
// application and restores it to bottom, visible reads only take a snapshot.
function terminal() {
  let offset = 42
  const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'pane.read') {
      if (params.source !== 'visible') offset = 0
      return { read: { text: 'Codex ready' } }
    }
    return { process_info: { shell_pid: 2000, foreground_process_group_id: 2001,
      foreground_processes: [{ pid: 2001, name: 'codex', argv: ['codex'] }] } }
  })
  return { call, offset: () => offset }
}

describe('passive terminal status reads', () => {
  it('reads status without navigating the existing viewport', async () => {
    const t = terminal()
    expect(await readPassiveScreen(t.call, 'w1:p1')).toBe('Codex ready')
    expect(t.offset()).toBe(42)
  })
  it('repeated self-update polling leaves a reading position alone', async () => {
    const t = terminal()
    let now = 10000
    const monitor = createSelfUpdates({ call: t.call, now: () => now, sleep: async () => {},
      chat: async () => ({ available: false, reason: 'not_found' }) })
    const p = { id: 'w1:p1', workspace: 'w1', agent: 'codex', agentSession: null,
      bornAt: 9000, status: 'idle', cwd: '/tmp' } as Pane
    for (let i = 0; i < 8; i++) { await monitor.observe(p, false); now += 5000 }
    expect(t.call.mock.calls.filter(([method]) => method === 'pane.read').length).toBe(8)
    expect(t.offset()).toBe(42)
  })
})
