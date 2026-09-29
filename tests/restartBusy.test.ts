import { describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ methods: [] as string[] }))

vi.mock('../server/utils/env', () => ({ log: () => {} }))
vi.mock('../server/utils/state', () => ({
  findPane: () => ({ id: 'w1:p1', agent: 'codex', status: 'idle', name: 'codex-a1', agentSession: null }),
  poll: () => {},
  restarts: new Map(),
  transcripts: { locate: async () => null },
}))
vi.mock('../server/utils/herdr', () => ({
  HerdrError: class HerdrError extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
  sleep: async () => {},
  herdr: async (method: string) => {
    calls.methods.push(method)
    await new Promise(r => setTimeout(r, 5))
    // Le shell est au premier plan : l'agent est considéré comme arrêté.
    return method === 'pane.process_info' ? { process_info: { foreground_processes: [], shell_pid: 1, foreground_process_group_id: 1 } } : {}
  },
}))

import { restartAgent } from '../server/utils/restart'

describe('redémarrage : double toucher', () => {
  it('une seule séquence quand deux demandes arrivent pendant la lecture du plan', async () => {
    const [a, b] = await Promise.allSettled([restartAgent('w1:p1'), restartAgent('w1:p1')])
    expect(a.status).toBe('fulfilled')
    expect(b.status).toBe('rejected')
    expect((b as PromiseRejectedResult).reason.code).toBe('restart_busy')
    await vi.waitFor(() => expect(calls.methods).toContain('agent.start'))
    expect(calls.methods.filter(m => m === 'agent.start')).toHaveLength(1)
    expect(calls.methods.filter(m => m === 'pane.process_info').length).toBeGreaterThan(0)
  })
})
