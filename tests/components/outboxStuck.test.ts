// A send whose request never answers: "Not sent" after SEND_STUCK_MS, and
// neither Retry nor the next sends of the conversation wait for it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueuedMessage } from '#shared/types'

const calls: { text: string, resolve: (q: QueuedMessage | null) => void }[] = []
vi.mock('~/composables/useActions', () => ({
  sendMessage: (_p: unknown, _pane: string, text: string, id: string) => new Promise<QueuedMessage | null>((resolve) => {
    calls.push({ text, resolve: q => resolve(q && { ...q, id }) })
  }),
}))

const { SendStuckError, outboxFor, outboxRetry, outboxSend } = await import('~/composables/useOutbox')
const { SEND_STUCK_MS } = await import('~/utils/outbox')

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe('outbox: a request that never answers', () => {
  afterEach(() => {
    vi.useRealTimers()
    calls.length = 0
  })

  it('turns Not sent, then Retry and a new send each make their own request', async () => {
    vi.useFakeTimers()
    const pane = 'w-stuck:p1'
    const first = outboxSend(undefined, pane, 'hello').catch(e => e)
    await flush()
    expect(calls.map(c => c.text)).toEqual(['hello'])
    expect(outboxFor(pane)[0]!.state).toBe('sending')

    await vi.advanceTimersByTimeAsync(SEND_STUCK_MS)
    expect(await first).toBeInstanceOf(SendStuckError)
    expect(outboxFor(pane)[0]).toMatchObject({ text: 'hello', state: 'failed', local: true })

    const id = outboxFor(pane)[0]!.id
    const retry = outboxRetry(undefined, pane, id)
    await flush()
    const next = outboxSend(undefined, pane, 'second')
    await flush()
    // The retry is sent at once; the next send waits for it only.
    expect(calls.map(c => c.text)).toEqual(['hello', 'hello'])
    calls[1]!.resolve({ id: '', text: 'hello', at: 1 })
    expect(await retry).toMatchObject({ id, text: 'hello' })
    await flush()
    expect(calls.map(c => c.text)).toEqual(['hello', 'hello', 'second'])
    calls[2]!.resolve(null)
    expect(await next).toBeNull()
    expect(outboxFor(pane).map(q => [q.text, q.state ?? null, q.local ?? false])).toEqual([['hello', null, false]])
  })

  it('a late answer of the stuck request still replaces the Not sent bubble', async () => {
    vi.useFakeTimers()
    const pane = 'w-late:p1'
    const first = outboxSend(undefined, pane, 'late one').catch(e => e)
    await flush()
    await vi.advanceTimersByTimeAsync(SEND_STUCK_MS)
    await first
    expect(outboxFor(pane)[0]!.state).toBe('failed')
    calls[0]!.resolve({ id: '', text: 'late one', at: 1 })
    await flush()
    expect(outboxFor(pane)[0]).toMatchObject({ text: 'late one' })
    expect(outboxFor(pane)[0]!.local).toBeUndefined()
  })
})
