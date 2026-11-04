// Settings › Dictation › On this device: the catalog's models with languages,
// size and ratings; GPU models only with WebGPU; install, progress, delete,
// space used; the chosen model saved on this device.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import DictationDeviceSettings from '~/components/DictationDeviceSettings.vue'
import { DEVICE_MODEL_KEY } from '~/utils/dictation/deviceModels'
import type { DeviceModel } from '~/utils/dictation/deviceModels'
import { fakeCaches, rangeServer } from '../fakeModelCache'

// One more model, for the GPU only.
vi.mock('~/utils/dictation/models.json', async (real) => {
  const { default: catalog } = await real<{ default: { models: DeviceModel[] } }>()
  const gpu = { ...catalog.models[1]!, id: 'gpu-model', name: 'GPU model', requires: ['webgpu', 'shader-f16'], quality: [], speed: undefined }
  return { default: { ...catalog, models: [...catalog.models, gpu] } }
})

const rows = (w: Awaited<ReturnType<typeof mountSuspended>>) => w.findAll('.dictation-model')
const rating = (r: ReturnType<Awaited<ReturnType<typeof mountSuspended>>['find']>) => r.findAll('.dictation-model-rating span, .dictation-model-rating i').map(e => e.text())
const row = (w: Awaited<ReturnType<typeof mountSuspended>>, id: string) => w.find(`[data-model="${id}"]`)

beforeEach(() => {
  localStorage.removeItem(DEVICE_MODEL_KEY)
  vi.stubGlobal('caches', fakeCaches())
})
afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'gpu')
})

describe('DictationDeviceSettings', () => {
  it('lists each model with its languages, size, quality and speed, and no GPU model without WebGPU', async () => {
    const w = await mountSuspended(DictationDeviceSettings)
    await flushPromises()
    expect(rows(w).map(r => r.find('b').text())).toEqual(['Parakeet v3', 'SenseVoice'])
    const parakeet = row(w, 'parakeet-v3')
    expect(parakeet.find('.dictation-model-meta').text()).toBe('FR · EN · +23 · 670 MB')
    expect(rating(parakeet)).toEqual(['Quality', 'FR ■■■■□', 'EN ■■■■■', 'Speed', '■■■□□ est.'])
    expect(parakeet.find('[role="radio"]').attributes('aria-checked')).toBe('true')
    const sense = row(w, 'sensevoice')
    expect(sense.find('.dictation-model-meta').text()).toBe('EN · +4 · 237 MB')
    expect(rating(sense)).toEqual(['Quality', 'FR —', 'EN ■■□□□', 'Speed', '■■■■■ est.'])
    expect(sense.find('button:not([role])').text()).toBe('Install · 237 MB')
  })

  it('shows a GPU model when the device has WebGPU with f16, unknown figures as unknown', async () => {
    Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) } })
    const w = await mountSuspended(DictationDeviceSettings)
    await flushPromises()
    expect(rows(w)).toHaveLength(3)
    expect(rating(row(w, 'gpu-model'))).toEqual(['Quality', 'FR —', 'EN unknown', 'Speed', 'unknown'])
  })

  it('installs with progress, counts the space used, deletes, and saves the chosen model', async () => {
    const w = await mountSuspended(DictationDeviceSettings)
    await flushPromises()
    const sense = () => row(w, 'sensevoice')
    vi.stubGlobal('fetch', rangeServer((await import('~/utils/dictation/deviceModels')).DEVICE_MODELS[1]!).fetch)
    await sense().find('button:not([role])').trigger('click')
    expect(sense().find('progress').exists()).toBe(true)
    await vi.waitFor(() => expect(sense().find('[data-testid="model-state"]').text()).toContain('Installed'), { timeout: 5000 })
    expect(w.find('[data-testid="dictation-storage"]').text()).toContain('237 MB used on this device')

    await sense().findAll('button').find(b => b.text() === 'Delete')!.trigger('click')
    await vi.waitFor(() => expect(sense().find('[data-testid="model-state"]').text()).toBe('Install · 237 MB'))
    expect(w.find('[data-testid="dictation-storage"]').text()).toContain('0 B used on this device')

    await sense().find('[role="radio"]').trigger('click')
    expect(localStorage.getItem(DEVICE_MODEL_KEY)).toBe('sensevoice')
    expect(sense().find('[role="radio"]').attributes('aria-checked')).toBe('true')
  })

  it('says the server is missing the model files on a 404, with the fetch command', async () => {
    const w = await mountSuspended(DictationDeviceSettings)
    await flushPromises()
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    await row(w, 'sensevoice').find('button:not([role])').trigger('click')
    const msg = () => row(w, 'sensevoice').find('[data-testid="model-missing"]')
    await vi.waitFor(() => expect(msg().exists()).toBe(true))
    expect(msg().text()).toContain('The wherdr server does not have this model’s files')
    expect(msg().find('code').text()).toBe('node scripts/fetch-dictation-files.mjs runtime sensevoice')
    expect(msg().text()).toContain('docs/installation.md')
    expect(msg().text()).not.toContain('HTTP 404')
  })
})
