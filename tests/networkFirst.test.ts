import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { networkFirst } from '../app/service-worker/networkFirst'

const WAIT_MS = 3000
const page = (body: string) => new Response(body)
// A server that accepted the connection and never answers (phone on a
// tailnet whose wherdr host is gone): the request never settles.
const silent = () => Promise.withResolvers<Response>().promise

describe('service worker network first', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('serves the cached copy once the server has stayed silent for the wait', async () => {
    let served: Response | undefined
    void networkFirst(silent(), async () => page('cached'), WAIT_MS).then((r) => { served = r })
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1)
    expect(served).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(await served?.text()).toBe('cached')
  })

  it('keeps waiting for a slow server when nothing is cached', async () => {
    const network = Promise.withResolvers<Response>()
    let served: Response | undefined
    void networkFirst(network.promise, async () => undefined, WAIT_MS).then((r) => { served = r })
    await vi.advanceTimersByTimeAsync(WAIT_MS * 10)
    expect(served).toBeUndefined()
    network.resolve(page('fresh'))
    await vi.advanceTimersByTimeAsync(0)
    expect(await served?.text()).toBe('fresh')
  })

  it('waits for the server answer when the cache cannot be read', async () => {
    const network = Promise.withResolvers<Response>()
    let served: Response | undefined
    void networkFirst(network.promise, async () => { throw new Error('UnknownError: Internal error') }, WAIT_MS).then((r) => { served = r })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    network.resolve(page('fresh'))
    await vi.advanceTimersByTimeAsync(0)
    expect(await served?.text()).toBe('fresh')
  })

  it('prefers the server answer to the cached copy when it arrives in time', async () => {
    const served = await networkFirst(Promise.resolve(page('fresh')), async () => page('cached'), WAIT_MS)
    expect(await served.text()).toBe('fresh')
  })

  it('serves the cached copy at once when the network fails', async () => {
    let served: Response | undefined
    void networkFirst(Promise.reject(new TypeError('Failed to fetch')), async () => page('cached'), WAIT_MS).then((r) => { served = r })
    await vi.advanceTimersByTimeAsync(0)
    expect(await served?.text()).toBe('cached')
  })
})
