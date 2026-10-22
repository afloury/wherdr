import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody, setResponseStatus } from 'h3'
import MachineConnection from '~/components/MachineConnection.vue'

let supported = true
let failure = false
let calls: unknown[] = []
registerEndpoint('/api/machine/status', { method: 'POST', handler: async event => {
  calls.push(['status', await readBody(event)])
  if (failure) { setResponseStatus(event, 502); return { error: 'Machine status unavailable' } }
  return supported
    ? { supported: true, status: 'auth required', error: 'SSH approval needed', reconnect: "herdr machine reconnect 'abcdef0123456789abcdef0123456789'" }
    : { supported: false, status: null, error: null, reconnect: null }
} })
registerEndpoint('/api/machine/reconnect', { method: 'POST', handler: async event => {
  calls.push(['retry', await readBody(event)])
  return { ok: true }
} })
const machine = { key: 'abcdef01', label: 'Workbox', local: false, status: 'offline' as const, error: 'Connection unavailable' }
let mounted: { unmount: () => void } | null = null
afterEach(() => { mounted?.unmount(); mounted = null; supported = true; failure = false; calls = []; vi.restoreAllMocks() })
async function mount() {
  const w = await mountSuspended(MachineConnection, { props: { machine } })
  mounted = w
  await vi.waitFor(() => expect(w.find('[role="status"]').exists() || w.find('[role="alert"]').exists() || w.text().includes('diagnostics require')).toBe(true))
  return w
}

describe('machine connection diagnostic sheet', () => {
  it('shows native authentication state and an interactive command without executing it', async () => {
    const w = await mount()
    expect(w.text()).toContain('Authentication required')
    expect(w.find('code').text()).toContain('herdr machine reconnect')
    expect(calls).toEqual([['status', { key: machine.key }]])
    const retry = w.findAll('button').find(b => b.text() === 'Retry connection')!
    await retry.trigger('click')
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(calls).toEqual([['status', { key: machine.key }], ['retry', { key: machine.key }], ['status', { key: machine.key }]])
    await flushPromises()
  })
  it('keeps retries available on older Herdr and hides the unsupported command', async () => {
    supported = false
    const w = await mount()
    expect(w.text()).toContain('diagnostics require Herdr 0.9.2')
    expect(w.find('code').exists()).toBe(false)
    expect(w.findAll('button').find(b => b.text() === 'Retry connection')!.attributes('disabled')).toBeUndefined()
  })
  it('keeps transport failures visible', async () => {
    failure = true
    const w = await mount()
    expect(w.get('[role="alert"]').text()).toContain('Machine status unavailable')
    expect(w.find('code').exists()).toBe(false)
  })
})
