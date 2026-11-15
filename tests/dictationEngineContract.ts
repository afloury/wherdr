// The contract every dictation engine passes (app/utils/dictation/engine.ts).
// An engine's own test calls it with a factory:
//   runDictationEngineContract('cloud', () => createCloudEngine(...))
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TAKE_RATE, isAbortError } from '../app/utils/dictation/engine'
import type { DictationEngine } from '../app/utils/dictation/engine'

const second = () => ({ pcm: new Float32Array(TAKE_RATE), seconds: 1 })

export function runDictationEngineContract(name: string, make: () => DictationEngine | Promise<DictationEngine>) {
  describe(`dictation engine contract: ${name}`, () => {
    afterEach(() => { vi.unstubAllGlobals() })

    it('describes itself', async () => {
      const engine = await make()
      expect(['device', 'cloud']).toContain(engine.id)
      expect(typeof engine.caps.terms).toBe('boolean')
      expect(typeof engine.caps.offline).toBe('boolean')
      engine.dispose()
    })

    it('answers readiness without the network, never rejecting', async () => {
      vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
      const engine = await make()
      const r = await engine.readiness()
      expect(typeof r.ready).toBe('boolean')
      engine.dispose()
    })

    it('rejects at once with an AbortError when cancelled during transcribe', async () => {
      const engine = await make()
      const abort = new AbortController()
      const run = engine.transcribe(second(), { terms: [], signal: abort.signal })
      abort.abort()
      const err = await run.then(() => null, (e: unknown) => e)
      expect(isAbortError(err)).toBe(true)
      engine.dispose()
    })

    it('rejects a take whose signal is already aborted', async () => {
      const engine = await make()
      const abort = new AbortController()
      abort.abort()
      const err = await engine.transcribe(second(), { terms: ['wherdr'], signal: abort.signal }).then(() => null, (e: unknown) => e)
      expect(isAbortError(err)).toBe(true)
      engine.dispose()
    })

    it('disposes twice without throwing', async () => {
      const engine = await make()
      engine.dispose()
      expect(() => engine.dispose()).not.toThrow()
    })
  })
}
