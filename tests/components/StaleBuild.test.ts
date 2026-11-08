import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { newVersionReady, reloadIfNewBuild } from '~/composables/useAppVersion'

// A file of the running build is missing (removed by a deployment): move to the
// served build once, then the banner if that was not enough.
const served = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }))

let reload: ReturnType<typeof vi.fn>
beforeEach(() => {
  newVersionReady.value = false
  sessionStorage.clear()
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, hash: '', pathname: '/', search: '', reload, replace: vi.fn() })
})
afterEach(() => { vi.unstubAllGlobals() })

it('does nothing when the server still serves this build or is unreachable', async () => {
  vi.stubGlobal('fetch', served({ id: useRuntimeConfig().app.buildId }))
  expect(await reloadIfNewBuild()).toBe(false)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
  expect(await reloadIfNewBuild()).toBe(false)
  expect(reload).not.toHaveBeenCalled()
  expect(newVersionReady.value).toBe(false)
})

it('reloads once to a newer build, then falls back to the banner', async () => {
  vi.stubGlobal('fetch', served({ id: 'newer-build' }))
  expect(await reloadIfNewBuild()).toBe(true)
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  // Right after that reload, still missing: no loop, the banner.
  expect(await reloadIfNewBuild()).toBe(true)
  expect(newVersionReady.value).toBe(true)
  expect(reload).toHaveBeenCalledTimes(1)
})
