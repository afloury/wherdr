import { describe, expect, it } from 'vitest'
import { CHAT_COLD_READ_MS, CHAT_READ_MS, applyToolUpdates, chatReadTimeoutMs, mergeToolUpdates, retainToolUpdates } from '../app/utils/chatTail'
import type { ChatItem, ToolUpdate } from '../shared/types'

const call = (toolId: string, extra: Partial<ChatItem> = {}): ChatItem => ({
  role: 'tool',
  name: 'read_file',
  text: '/w/a.ts',
  toolId,
  ts: '2026-01-01T00:00:00.000Z',
  ...extra,
})

const upd = (id: string, at: number, extra: Partial<ToolUpdate> = {}): ToolUpdate => ({
  id,
  at,
  out: `out-${at}`,
  error: false,
  images: 0,
  ref: '',
  imageAt: 0,
  ...extra,
})

describe('chatTail toolUpdates', () => {
  it('applyToolUpdates preserves object identity when unchanged and clears stale hashes when changed', () => {
    const items = [call('t1', { hashes: ['stale'], out: 'old', toolAt: 100 }), call('t2')]
    expect(applyToolUpdates(items, undefined)).toBe(items)

    const next = applyToolUpdates(items, [upd('t1', 200, { out: 'new', error: true, images: 1, ref: '200:5', imageAt: 205 })])
    expect(next).not.toBe(items)
    expect(next[0]).toEqual({
      ...call('t1'),
      toolAt: 200,
      out: 'new',
      error: true,
      images: 1,
      ref: '200:5',
      imageAt: 205,
    })
    expect('hashes' in next[0]!).toBe(false)
    expect(next[1]).toBe(items[1])

    // Same normalized values: array and item identities stay intact.
    expect(applyToolUpdates(next, [upd('t1', 200, { out: 'new', error: true, images: 1, ref: '200:5', imageAt: 205 })])).toBe(next)
  })

  it('never downgrades a newer revision to an older or unknown revision, and lets equal revisions rewrite', () => {
    const items = [call('t1', { toolAt: 500, out: 'newer' })]
    expect(applyToolUpdates(items, [upd('t1', 400, { out: 'older' })])).toBe(items)
    expect(applyToolUpdates(items, [upd('t1', -1, { out: 'unknown' })])).toBe(items)
    const rewritten = applyToolUpdates(items, [upd('t1', 500, { out: '' })])
    expect(rewritten[0]!.out).toBeUndefined()
    expect(rewritten[0]!.toolAt).toBe(500)
  })

  it('mergeToolUpdates and retainToolUpdates track cross-page updates and bound at 256', () => {
    const pending = new Map<string, ToolUpdate>([
      ['t1', upd('t1', 300, { out: 'late' })],
      ['t2', upd('t2', 400, { out: 'wait' })],
    ])
    const merged = mergeToolUpdates(pending, [upd('t1', 200, { out: 'older' }), upd('t3', 500)])
    expect(merged).toEqual([
      upd('t1', 300, { out: 'late' }),
      upd('t2', 400, { out: 'wait' }),
      upd('t3', 500),
    ])

    // Satisfying t1 only at an older toolAt keeps t1 pending; satisfying at >= 300 clears it.
    retainToolUpdates(pending, [[call('t1', { toolAt: 250 })]], merged)
    expect(pending.has('t1')).toBe(true)
    retainToolUpdates(pending, [[call('t1', { toolAt: 300 })]], merged)
    expect(pending.has('t1')).toBe(false)
    expect(pending.has('t2')).toBe(true)
    expect(pending.has('t3')).toBe(true)

    const many = Array.from({ length: 260 }, (_, i) => upd(`k${i}`, i + 1))
    retainToolUpdates(pending, [[]], many)
    expect(pending.size).toBe(256)
    expect(pending.has('t2')).toBe(false)
    expect(pending.has('k259')).toBe(true)
  })
})

// The /api/chat read deadline: pure helper, no store or fetch.
describe('chatTail read deadline', () => {
  it('gives a cold snapshot-backed read 30 s and keeps 8 s for polls and JSONL agents', () => {
    for (const agent of ['agy', 'hermes']) {
      expect(chatReadTimeoutMs(agent, true)).toBe(CHAT_COLD_READ_MS)
      expect(chatReadTimeoutMs(agent, true)).toBe(30_000)
      expect(chatReadTimeoutMs(agent, false)).toBe(CHAT_READ_MS)
    }
    // A JSONL conversation opens in one bounded read: no cold allowance.
    for (const agent of ['claude', 'codex', 'omp', 'devin', 'cmd', null, undefined]) {
      expect(chatReadTimeoutMs(agent, true)).toBe(CHAT_READ_MS)
      expect(chatReadTimeoutMs(agent, false)).toBe(CHAT_READ_MS)
    }
    expect(chatReadTimeoutMs('agy', false)).toBe(8000)
  })
})
