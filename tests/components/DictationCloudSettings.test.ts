// Settings › Dictation › Online: the key goes to the server and never comes
// back to the page (only its last 4 characters); options stay on the device.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import DictationCloudSettings from '~/components/DictationCloudSettings.vue'
import { CLOUD_OPTIONS_KEY } from '~/utils/dictation/cloudOptions'

const KEY = 'sk-or-v1-0123456789abcdef3f2a'
let saved = ''
const status = () => saved ? { set: true, last4: saved.slice(-4) } : { set: false }
registerEndpoint('/api/dictation/status', () => status())
registerEndpoint('/api/dictation/key', { method: 'POST', handler: async (e) => {
  const { readBody } = await import('h3')
  saved = String((await readBody<{ key: string }>(e)).key)
  return status()
} })
registerEndpoint('/api/dictation/key', { method: 'DELETE', handler: () => { saved = ''; return status() } })

beforeEach(() => { saved = ''; localStorage.removeItem(CLOUD_OPTIONS_KEY) })

describe('DictationCloudSettings', () => {
  it('saves the key, then shows only its last 4 characters and can remove it', async () => {
    const w = await mountSuspended(DictationCloudSettings)
    await flushPromises()
    expect(w.find('[data-testid="dictation-test"]').attributes('disabled')).toBeDefined()
    await w.find('input[type="password"]').setValue(KEY)
    await w.find('form').trigger('submit')
    await vi.waitFor(() => expect(saved).toBe(KEY))
    await vi.waitFor(() => expect(w.find('[data-testid="dictation-key-mask"]').text()).toBe('••••••••3f2a'))
    expect(w.html()).not.toContain(KEY)
    expect(w.find('[data-testid="dictation-test"]').attributes('disabled')).toBeUndefined()
    await w.findAll('button').find(b => b.text() === 'Remove')!.trigger('click')
    await vi.waitFor(() => expect(w.find('input[type="password"]').exists()).toBe(true))
    expect(saved).toBe('')
  })

  it('keeps ZDR on and pane terms off by default, saved on this device', async () => {
    const w = await mountSuspended(DictationCloudSettings)
    await flushPromises()
    const switches = w.findAll('[role="switch"]')
    expect(switches.map(s => s.attributes('aria-checked'))).toEqual(['true', 'false'])
    await switches[1]!.trigger('click')
    await flushPromises()
    expect(JSON.parse(localStorage.getItem(CLOUD_OPTIONS_KEY)!)).toMatchObject({ zdr: true, terms: true, model: 'openai/whisper-large-v3-turbo' })
  })
})
