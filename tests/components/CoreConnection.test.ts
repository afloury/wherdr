import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import CoreConnection from '~/components/CoreConnection.vue'

afterEach(() => vi.unstubAllGlobals())
it('shows an unavailable core, then retries to show a compatible core', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ status: 503, json: async () => ({ ok: false, error: 'Cannot connect to herdr-core' }) })
    .mockResolvedValueOnce({ status: 200, json: async () => ({ ok: true, version: '0.1.16' }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ terminals: [], machines: [], hidden_finished: 0 }) })
  vi.stubGlobal('fetch', fetch)
  const w = await mountSuspended(CoreConnection)
  try {
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('Cannot connect to herdr-core')
    await w.get('button').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Connected to herdr-core · 0.1.16')
    expect(fetch).toHaveBeenCalledWith('/api/core', { cache: 'no-store' })
    // Connected: the inventory replaces the retry button.
    expect(w.text()).toContain('No live terminals')
    expect(fetch).toHaveBeenLastCalledWith('/api/core/terminals', { cache: 'no-store' })
  } finally { w.unmount() }
})
it('explains incompatible capabilities', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 503, json: async () => ({ ok: false,
    error: 'herdr-core is missing required capabilities', hint: 'terminal.attach' }) }))
  const w = await mountSuspended(CoreConnection)
  try {
    await flushPromises()
    expect(w.text()).toContain('Missing methods: terminal.attach')
    expect(w.get('[role="alert"]').text()).toContain('missing required capabilities')
  } finally { w.unmount() }
})
it('offers passkey unlock when the server returns 401', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, json: async () => ({ code: 'locked' }) }))
  const w = await mountSuspended(CoreConnection)
  try {
    await flushPromises()
    expect(w.text()).toContain('wherdr is locked')
    expect(w.findAll('button').some(b => b.text() === 'Unlock')).toBe(true)
  } finally { w.unmount() }
})
