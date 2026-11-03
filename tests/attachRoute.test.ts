import { afterEach, expect, it, vi } from 'vitest'
import { HerdrError } from '../server/utils/herdr'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

async function run(backend: string, pane: string) {
  vi.stubEnv('WHERDR_BACKEND', backend)
  const core = vi.fn(async () => ({ path: '/x/a.txt' }))
  const save = vi.fn(async () => ({ path: '/y/a.txt' }))
  for (const [k, v] of Object.entries({
    defineApi: (h: unknown) => h, HerdrError, PANE_RE: /^w[0-9a-z]+:p[0-9a-z]+$/i,
    getQuery: () => ({ pane, name: 'a.txt' }), coreInputDeps: () => ({}),
    corePutAttachment: core, saveAttachment: save,
  })) vi.stubGlobal(k, v)
  const handler = (await import('../server/api/attach.post')).default as unknown as (e: unknown, b: unknown) => Promise<unknown>
  return { core, save, call: async () => handler({}, { data: Buffer.from('hi') }) }
}

it('accepts a herdr-core pane id', async () => {
  const t = await run('core', 's1a2b:p3')
  await expect(t.call()).resolves.toEqual({ path: '/x/a.txt' })
  expect(t.core).toHaveBeenCalledWith({}, 's1a2b:p3', 'a.txt', expect.any(Buffer))
})

it('still rejects an invalid pane on the classic backend', async () => {
  const t = await run('classic', 's1a2b:p3')
  await expect(t.call()).rejects.toThrow('Invalid pane')
  expect(t.save).not.toHaveBeenCalled()
})
