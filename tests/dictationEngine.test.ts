import { describe, expect, it } from 'vitest'
import { runDictationEngineContract } from './dictationEngineContract'
import { createFakeEngine } from './fakeDictationEngine'
import { ENGINES, disposeEngines, loadEngine } from '../app/utils/dictation/registry'
import { createResampler } from '../app/utils/dictation/audio'

runDictationEngineContract('fake', () => createFakeEngine({ delayMs: 50 }))

describe('dictation engine registry', () => {
  it('loads an engine once and frees it on dispose', async () => {
    let made = 0
    const fake = createFakeEngine()
    ENGINES.device = async () => { made++; return fake }
    expect(await loadEngine('device')).toBe(await loadEngine('device'))
    expect(made).toBe(1)
    disposeEngines()
    await Promise.resolve()
    expect(fake.disposed).toBe(1)
    await loadEngine('device')
    expect(made).toBe(2)
    delete ENGINES.device
    disposeEngines()
  })

  it('rejects an engine that is not built in', async () => {
    await expect(loadEngine('cloud')).rejects.toThrow('not available')
  })
})

describe('createResampler', () => {
  it('turns 48 kHz into 16 kHz across buffers, losing no sample at the joins', () => {
    const ramp = Float32Array.from({ length: 4096 * 3 }, (_, i) => i / 48000)
    const resample = createResampler(48000)
    const out = [0, 1, 2].flatMap(b => [...resample(ramp.subarray(b * 4096, (b + 1) * 4096))])
    expect(out).toHaveLength(4096)
    out.forEach((v, k) => expect(v).toBeCloseTo(k / 16000, 6))
  })

  it('also handles a rate that is not a multiple of 16 kHz', () => {
    const ramp = Float32Array.from({ length: 44100 }, (_, i) => i / 44100)
    const resample = createResampler(44100)
    const out = [...resample(ramp.subarray(0, 1000)), ...resample(ramp.subarray(1000))]
    expect(out).toHaveLength(16000)
    out.forEach((v, k) => expect(v).toBeCloseTo(k / 16000, 6))
  })
})
