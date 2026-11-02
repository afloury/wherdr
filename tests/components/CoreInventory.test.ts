import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import CoreInventory from '~/components/CoreInventory.vue'
const terminal = { address: 'host-a/t7', name: 'review', cwd: '/workspace/demo', state: 'live' }
afterEach(() => vi.unstubAllGlobals())
it('lists unknown terminals, reads qualified details and returns to the list', async () => {
  const fetch = vi.fn().mockImplementation(async (url: string) => ({ ok: true, status: 200,
    json: async () => url.includes('?') ? terminal : { terminals: [terminal], machines: [], hidden_finished: 0 } }))
  vi.stubGlobal('fetch', fetch)
  const w = await mountSuspended(CoreInventory)
  try {
    await flushPromises()
    expect(w.get('.card-state').text()).toBe('Unknown')
    await w.get('.core-card').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith('/api/core/terminals?terminal=host-a%2Ft7', { cache: 'no-store' })
    expect(w.text()).toContain('Conversation unavailable')
    expect(w.text()).toContain('live')
    await w.get('[aria-label="Back"]').trigger('click')
    await flushPromises()
    expect(w.find('.core-card').exists()).toBe(true)
  } finally { w.unmount() }
})
it('clears stale details on failure and requests unlock for an expired session', async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ terminals: [terminal], machines: [], hidden_finished: 0 }) })
    .mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ status: 401 })
  vi.stubGlobal('fetch', fetch)
  const w = await mountSuspended(CoreInventory)
  try {
    await flushPromises()
    await w.get('.core-card').trigger('click')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toBe('Cannot read herdr-core inventory')
    expect(w.find('dl').exists()).toBe(false)
    await w.get('button').trigger('click')
    await flushPromises()
    expect(w.emitted('locked')).toHaveLength(1)
  } finally { w.unmount() }
})
it('shows empty inventory and unavailable machines without claiming their agents finished', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ terminals: [],
    machines: [{ name: 'host-b', state: 'unreachable' }], hidden_finished: 2 }) }))
  const w = await mountSuspended(CoreInventory)
  try {
    await flushPromises()
    expect(w.text()).toContain('No live terminals')
    expect(w.text()).toContain('host-b · unreachable')
    expect(w.text()).toContain('2 finished terminals hidden')
  } finally { w.unmount() }
})
