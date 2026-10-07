import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '~/composables/useHerdr'

// Headers received, then the body stalls until the caller's deadline aborts it.
// Resolves once the body is being read.
function stalledBody() {
  const reading = Promise.withResolvers<void>()
  vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    json: () => {
      const body = Promise.withResolvers<unknown>()
      init.signal?.addEventListener('abort', () => body.reject(init.signal?.reason))
      reading.resolve()
      return body.promise
    },
  }))
  return reading.promise
}

describe('api deadline', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  // An empty answer from the status check would read as "lock off" and open
  // the offline cache without a lease.
  it('fails when the deadline passes while the body is read, never answers {}', async () => {
    const reading = stalledBody()
    const deadline = new AbortController()
    const status = api('/api/auth/status?resume=1', undefined, deadline.signal)
    await reading
    deadline.abort(new DOMException('signal timed out', 'TimeoutError'))
    await expect(status).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
