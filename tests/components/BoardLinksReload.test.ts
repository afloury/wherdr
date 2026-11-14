// A reloaded page first shows the state saved on the device (offline view):
// the board's links are read as soon as the live state replaces it, not at the
// next poll 15 s later.
import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick } from 'vue'
import { cachedAt } from '~/composables/useHerdr'
import { useBoardLinks } from '~/composables/useBoardLinks'

afterEach(() => {
  cachedAt.value = null
  vi.unstubAllGlobals()
})

it('reads the links when the offline view gives way to the live state', async () => {
  const fetch = vi.fn(async () => Response.json({ version: 'v1', machines: [] }))
  vi.stubGlobal('fetch', fetch)
  cachedAt.value = Date.now()
  await mountSuspended(defineComponent({ setup() { useBoardLinks(); return () => h('div') } }))
  const reads = () => fetch.mock.calls.filter(c => String(c[0]).startsWith('/api/tasks/links')).length
  expect(reads()).toBe(0)
  cachedAt.value = null
  await nextTick()
  expect(reads()).toBe(1)
})
