import { afterEach, expect, it, vi } from 'vitest'
import { chatHoverIntent, chatIntentKey, createChatIntentCache } from '../app/utils/chatIntent'
import type { ChatResponse, Pane } from '../shared/types'

const response: ChatResponse = { available: true, file: 'fixture.jsonl', token: 'v1', start: 4096, items: [] }
afterEach(() => vi.useRealTimers())
it('waits 65ms for a mouse, cancels on leave/unmount/context menu, and ignores touch hover', () => {
  vi.useFakeTimers()
  const run = vi.fn()
  const intent = chatHoverIntent(run)
  intent.enter('mouse')
  vi.advanceTimersByTime(64)
  expect(run).not.toHaveBeenCalled()
  intent.cancel()
  vi.advanceTimersByTime(100)
  expect(run).not.toHaveBeenCalled()
  intent.enter('touch')
  vi.advanceTimersByTime(100)
  expect(run).not.toHaveBeenCalled()
  intent.enter('mouse')
  vi.advanceTimersByTime(65)
  expect(run).toHaveBeenCalledTimes(1)
  intent.enter('mouse')
  intent.down()
  vi.advanceTimersByTime(100)
  expect(run).toHaveBeenCalledTimes(2)
})
it('deduplicates intent and hands an in-flight tail to opening once', async () => {
  let resolve!: (r: ChatResponse) => void
  const read = vi.fn(() => new Promise<ChatResponse>(r => { resolve = r }))
  const cache = createChatIntentCache(read)
  cache.preload('a', 'pane')
  cache.preload('a', 'pane')
  const opening = cache.take('a')
  resolve(response)
  expect(await opening).toBe(response)
  expect(await cache.take('a')).toBeUndefined()
  expect(read).toHaveBeenCalledTimes(1)
})
it('isolates machine, Herdr session, pane and agent session', () => {
  const pane = { id: 'w1:p1', machine: 'demo', agentSession: 'first' } as Pane
  const original = chatIntentKey(pane, 'main')
  for (const change of [{ machine: 'other' }, { id: 'w1:p2' }, { agentSession: 'next' }, { bornAt: 1 }]) {
    expect(chatIntentKey({ ...pane, ...change }, 'main')).not.toBe(original)
  }
  expect(chatIntentKey(pane, 'other')).not.toBe(original)
})
it('expires, caps entries and bytes, and rejects failures', async () => {
  vi.useFakeTimers()
  const read = vi.fn(async () => response)
  const cache = createChatIntentCache(read)
  for (let i = 0; i < 5; i++) cache.preload(String(i), 'pane')
  expect(await cache.take('0')).toBeUndefined()
  expect(await cache.take('4')).toBe(response)
  vi.advanceTimersByTime(5001)
  expect(await cache.take('3')).toBeUndefined()
  const large = createChatIntentCache(async () => ({ ...response, token: 'x'.repeat(500_001) }))
  large.preload('large', 'pane')
  expect(await large.take('large')).toBeUndefined()
  const failed = createChatIntentCache(async () => { throw new Error('offline') })
  failed.preload('failed', 'pane')
  expect(await failed.take('failed')).toBeUndefined()
})
it('invalidates in-flight reads on lock, disconnect or session change', async () => {
  let resolve!: (r: ChatResponse) => void
  let signal!: AbortSignal
  const cache = createChatIntentCache(async (_, s) => {
    signal = s
    return new Promise<ChatResponse>(r => { resolve = r })
  })
  cache.preload('a', 'pane')
  const opening = cache.take('a')
  cache.clear()
  expect(signal.aborted).toBe(true)
  resolve(response)
  expect(await opening).toBeUndefined()
})
