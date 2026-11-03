import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('passes a herdr-core pane id to corePutAttachment', async () => {
  const core = vi.fn(async () => ({ path: '/x/a.txt' }))
  for (const [k, v] of Object.entries({
    defineApi: (h: unknown) => h,
    getQuery: () => ({ pane: 's1a2b:p3', name: 'a.txt' }), coreInputDeps: () => ({}),
    corePutAttachment: core,
  })) vi.stubGlobal(k, v)
  const handler = (await import('../server/api/attach.post')).default as unknown as (e: unknown, b: unknown) => Promise<unknown>
  await expect(handler({}, { data: Buffer.from('hi') })).resolves.toEqual({ path: '/x/a.txt' })
  expect(core).toHaveBeenCalledWith({}, 's1a2b:p3', 'a.txt', expect.any(Buffer))
})
