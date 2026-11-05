import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules() })

async function navigation(hit: Response | undefined, network: Promise<Response>) {
  vi.useFakeTimers()
  const handlers: Record<string, (event: unknown) => void> = {}
  const put = vi.fn()
  vi.stubGlobal('self', {
    __WB_MANIFEST: [], location: new URL('https://app.example'),
    addEventListener: (type: string, fn: (event: unknown) => void) => { handlers[type] = fn },
  })
  vi.stubGlobal('caches', { match: vi.fn().mockResolvedValue(hit), open: async () => ({ put }) })
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(network))
  await import('../app/service-worker/sw')
  let served: Response | undefined
  const background: Promise<unknown>[] = []
  handlers.fetch!({
    request: { method: 'GET', url: 'https://app.example/?open=agent', mode: 'navigate' },
    respondWith: (response: Promise<Response>) => { void response.then(r => { served = r }) },
    waitUntil: (work: Promise<unknown>) => background.push(work),
  })
  await vi.advanceTimersByTimeAsync(0)
  return { served: () => served, background, put }
}

it('serves the cached shell immediately while a silent network stays pending', async () => {
  const network = Promise.withResolvers<Response>()
  const result = await navigation(new Response('cached shell'), network.promise)
  expect(await result.served()?.text()).toBe('cached shell')
  network.resolve(new Response('next shell'))
  await Promise.all(result.background)
  expect(await result.put.mock.calls[0]![1].text()).toBe('next shell')
})

it('uses the cached shell even when the network answers immediately', async () => {
  const result = await navigation(new Response('cached shell'), Promise.resolve(new Response('next shell')))
  expect(await result.served()?.text()).toBe('cached shell')
  await Promise.all(result.background)
})

it('waits for the network when the shell has not been cached', async () => {
  const network = Promise.withResolvers<Response>()
  const result = await navigation(undefined, network.promise)
  await vi.advanceTimersByTimeAsync(30000)
  expect(result.served()).toBeUndefined()
  network.resolve(new Response('first shell'))
  await Promise.all(result.background)
  expect(await result.served()?.text()).toBe('first shell')
})
