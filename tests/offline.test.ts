import { describe, expect, it } from 'vitest'
import type { ChatItem, HerdrState } from '../shared/types'
import { CHAT_BYTES, MAX_BYTES, MAX_CHATS, MAX_MESSAGES, pruneIndex, trimChat, type ChatEntry } from '../app/utils/offlineCache'
import { leaseFromStatus, mayReadOffline } from '../app/utils/offlineAccess'

const item = (text: string): ChatItem => ({ role: 'assistant', text, ts: null })
const state = (ids: string[], remoteOnline = true): HerdrState => ({
  ok: true, workspaces: [],
  panes: ids.map(id => ({ id, workspace: '', tab: '', tabLabel: null, agent: 'claude', name: null,
    label: null, status: 'idle', title: null, cwd: null, agentSession: null })),
  machines: [{ key: '', label: 'Server', local: true, status: 'online', error: null },
    { key: 'abcd1234', label: 'Laptop', local: false, status: remoteOnline ? 'online' : 'offline', error: null }],
})
const index = (ids: string[], bytes = 1000): ChatEntry[] => ids.map((id, used) => ({ id, used, bytes }))

describe('cache hors ligne', () => {
  it('bounds messages and bytes per conversation, keeping its end', () => {
    expect(trimChat(Array.from({ length: 300 }, (_, i) => item(String(i)))).items).toHaveLength(MAX_MESSAGES)
    const t = trimChat([item('x'.repeat(200_000)), item('fin')])
    expect(t.items).toEqual([item('fin')])
    expect(t.bytes).toBe(JSON.stringify(item('fin')).length * 2)
    const many = trimChat(Array.from({ length: 100 }, (_, i) => item(`${i}`.padEnd(2000, '.'))))
    expect(many.bytes).toBeLessThanOrEqual(CHAT_BYTES)
    expect(many.items.at(-1)!.text.startsWith('99')).toBe(true)
  })

  it('keeps the most recently used conversations, within the count and the bytes', () => {
    const r = pruneIndex(index(Array.from({ length: 20 }, (_, i) => `w1:p${i}`)), null, 0)
    expect(r.keep).toHaveLength(MAX_CHATS)
    expect(r.keep[0]?.id).toBe('w1:p19')
    expect(r.drop.sort()).toEqual(Array.from({ length: 8 }, (_, i) => `w1:p${i}`).sort())
    const big = pruneIndex(index(Array.from({ length: 12 }, (_, i) => `w1:p${i}`), 400_000), null, 1_000_000)
    expect(big.keep.reduce((a, c) => a + c.bytes, 0) + 1_000_000).toBeLessThanOrEqual(MAX_BYTES)
    expect(big.keep.map(c => c.id)).toEqual(['w1:p11', 'w1:p10', 'w1:p9', 'w1:p8', 'w1:p7', 'w1:p6', 'w1:p5'])
  })

  it('purges closed panes on reachable machines and keeps those of the offline computer', () => {
    const s = index(['w1:p1', 'w1:p2', 'abcd1234~w1:p1', 'abcd1234~w1:p2'])
    expect(pruneIndex(s, state(['w1:p1', 'abcd1234~w1:p1'], false), 0).keep.map(c => c.id).sort())
      .toEqual(['abcd1234~w1:p1', 'abcd1234~w1:p2', 'w1:p1'])
    const online = pruneIndex(s, state(['w1:p1', 'abcd1234~w1:p1']), 0)
    expect(online.keep.map(c => c.id).sort()).toEqual(['abcd1234~w1:p1', 'w1:p1'])
    expect(online.drop.sort()).toEqual(['abcd1234~w1:p2', 'w1:p2'])
  })

  it('expires reading with the lease and refuses a missing or implausible one', () => {
    const now = 10_000
    expect(mayReadOffline({ enabled: true, expiresAt: now + 1 }, now)).toBe(true)
    expect(mayReadOffline({ enabled: true, expiresAt: now }, now)).toBe(false)
    expect(mayReadOffline({ enabled: true, expiresAt: 0 }, now)).toBe(false)
    expect(mayReadOffline(null, now)).toBe(false)
    // A long session (1 year) reads offline; a lease beyond any duration offered does not.
    expect(mayReadOffline({ enabled: true, expiresAt: now + 365 * 24 * 3600 * 1000 }, now)).toBe(true)
    expect(mayReadOffline({ enabled: true, expiresAt: now + 400 * 24 * 3600 * 1000 }, now)).toBe(false)
  })

  it('puts the lease on the client clock so a lagging browser clock keeps a fresh lease', () => {
    const server = 1_000_000_000
    const client = server - 60_000 // browser one minute behind the server
    const lease = leaseFromStatus({ enabled: true, expiresAt: server + 12 * 3600 * 1000, now: server }, client)
    expect(lease).toEqual({ enabled: true, expiresAt: client + 12 * 3600 * 1000 })
    expect(mayReadOffline(lease, client)).toBe(true)
    expect(leaseFromStatus({ enabled: true, expiresAt: null, now: server }, client)).toEqual({ enabled: true, expiresAt: 0 })
    expect(leaseFromStatus({ enabled: false }, client)).toEqual({ enabled: false, expiresAt: 0 })
  })

  it('closes the cache past the maximum duration even while the sliding lease runs', () => {
    const server = 1_000_000_000
    const client = server + 30_000
    const lease = leaseFromStatus({ enabled: true, expiresAt: server + 12 * 3600 * 1000, deadline: server + 3600 * 1000, now: server }, client)
    expect(lease.deadline).toBe(client + 3600 * 1000)
    expect(mayReadOffline(lease, client + 3599 * 1000)).toBe(true)
    expect(mayReadOffline(lease, client + 3601 * 1000)).toBe(false)
  })
})
