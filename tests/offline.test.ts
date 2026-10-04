import { describe, expect, it } from 'vitest'
import type { ChatItem, HerdrState } from '../shared/types'
import { MAX_BYTES, MAX_CHATS, MAX_MESSAGES, pruneSnapshot, trimChat, type Snapshot } from '../app/utils/offlineCache'
import { leaseFromStatus, mayReadOffline } from '../app/utils/offlineAccess'

const item = (text: string): ChatItem => ({ role: 'assistant', text, ts: null })
const state = (ids: string[], remoteOnline = true): HerdrState => ({
  ok: true, workspaces: [],
  panes: ids.map(id => ({ id, workspace: '', tab: '', tabLabel: null, agent: 'claude', name: null,
    label: null, status: 'idle', title: null, cwd: null, agentSession: null })),
  machines: [{ key: '', label: 'Server', local: true, status: 'online', error: null },
    { key: 'abcd1234', label: 'Laptop', local: false, status: remoteOnline ? 'online' : 'offline', error: null }],
})
const snapshot = (ids: string[]): Snapshot => ({ home: null, chats: ids.map((id, used) => ({ id, used, at: 1, items: [item(id)] })) })

describe('cache hors ligne', () => {
  it('bounds messages, bytes per conversation and number of conversations with LRU', () => {
    expect(trimChat(Array.from({ length: 300 }, (_, i) => item(String(i))))).toHaveLength(MAX_MESSAGES)
    expect(trimChat([item('x'.repeat(200_000)), item('fin')])).toEqual([item('fin')])
    const s = pruneSnapshot(snapshot(Array.from({ length: 20 }, (_, i) => `w1:p${i}`)))
    expect(s.chats).toHaveLength(MAX_CHATS)
    expect(s.chats[0]?.id).toBe('w1:p19')
    const huge = snapshot(Array.from({ length: 12 }, (_, i) => `w1:p${i}`))
    huge.chats.forEach(c => { c.items = [item('x'.repeat(110_000))] })
    expect(JSON.stringify(pruneSnapshot(huge)).length * 2).toBeLessThanOrEqual(MAX_BYTES)
  })

  it('purges closed panes on reachable machines and keeps those of the offline computer', () => {
    const s = snapshot(['w1:p1', 'w1:p2', 'abcd1234~w1:p1', 'abcd1234~w1:p2'])
    expect(pruneSnapshot(s, state(['w1:p1', 'abcd1234~w1:p1'], false)).chats.map(c => c.id).sort())
      .toEqual(['abcd1234~w1:p1', 'abcd1234~w1:p2', 'w1:p1'])
    expect(pruneSnapshot(s, state(['w1:p1', 'abcd1234~w1:p1'])).chats.map(c => c.id).sort())
      .toEqual(['abcd1234~w1:p1', 'w1:p1'])
  })

  it('expires reading after 12 h and refuses a missing deadline', () => {
    const now = 10_000
    expect(mayReadOffline({ enabled: true, expiresAt: now + 1 }, now)).toBe(true)
    expect(mayReadOffline({ enabled: true, expiresAt: now }, now)).toBe(false)
    expect(mayReadOffline({ enabled: true, expiresAt: 0 }, now)).toBe(false)
    expect(mayReadOffline(null, now)).toBe(false)
  })

  it('puts the lease on the client clock so a lagging browser clock keeps a fresh lease', () => {
    const server = 1_000_000_000
    const client = server - 60_000 // browser one minute behind the server
    const lease = leaseFromStatus({ enabled: true, expiresAt: server + 12 * 3600 * 1000, now: server }, client)
    expect(lease).toEqual({ enabled: true, expiresAt: client + 12 * 3600 * 1000 })
    expect(mayReadOffline(lease, client)).toBe(true)
    // The raw server deadline would have been refused (more than 12 h ahead).
    expect(mayReadOffline({ enabled: true, expiresAt: server + 12 * 3600 * 1000 }, client)).toBe(false)
    expect(leaseFromStatus({ enabled: true, expiresAt: null, now: server }, client)).toEqual({ enabled: true, expiresAt: 0 })
    expect(leaseFromStatus({ enabled: false }, client)).toEqual({ enabled: false, expiresAt: 0 })
  })
})
