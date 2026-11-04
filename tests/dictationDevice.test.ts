// The on-device engine (app/utils/dictation/device.ts) against a worker that
// speaks the dictation worker's protocol; and its model list against the
// fetch script, which must put the same files where the engine looks.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runDictationEngineContract } from './dictationEngineContract'
import { createDeviceEngine } from '../app/utils/dictation/device'
import { DEVICE_CACHE, DEVICE_MODELS, DEVICE_RUNTIME, deviceModel } from '../app/utils/dictation/deviceModels'
import { TAKE_RATE, isAbortError } from '../app/utils/dictation/engine'
import { CHUNK } from '../app/utils/dictation/modelStore'
import { fakeCaches, rangeServer } from './fakeModelCache'
import { DEFAULT_SETS, SETS } from '../scripts/dictation-files.mjs'

const model = { ...DEVICE_MODELS[0]!, files: [{ path: 'a.onnx', bytes: 100 }, { path: 'tokens.txt', bytes: 10 }] }

class FakeWorker {
  static made: FakeWorker[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string, preventDefault?: () => void }) => void) | null = null
  got: { t: string, [k: string]: unknown }[] = []
  terminated = false
  constructor(private o: { loadError?: string, text?: string } = {}) { FakeWorker.made.push(this) }
  private send(data: unknown) { setTimeout(() => !this.terminated && this.onmessage?.({ data }), 1) }
  postMessage(m: { t: string, id?: number, pcm?: ArrayBuffer, files?: string[] }) {
    this.got.push(m)
    if (m.t === 'load') {
      if (this.o.loadError) return this.send({ t: 'error', error: this.o.loadError })
      this.send({ t: 'phase', phase: 'fetch' })
      this.send({ t: 'dl', file: 'a.onnx', got: 100, total: 100 })
      this.send({ t: 'dl', file: 'tokens.txt', got: 5, total: 10 })
      this.send({ t: 'ready', ms: 3, heap: 1 })
    }
    else this.send({ t: 'final', id: m.id, text: this.o.text ?? 'bonjour', ms: 7, heap: 1 })
  }
  terminate() { this.terminated = true }
}

const make = (o: ConstructorParameters<typeof FakeWorker>[0] = {}) =>
  createDeviceEngine({ model, caches: null, worker: () => new FakeWorker(o) as unknown as Worker })
const take = () => ({ pcm: new Float32Array(TAKE_RATE).fill(0.5), seconds: 1 })

afterEach(() => {
  FakeWorker.made = []
  vi.unstubAllGlobals()
})

runDictationEngineContract('device', () => make())

describe('the on-device engine', () => {
  it('loads the model once, reports overall download progress, and decodes a copy of the take', async () => {
    const engine = make()
    const seen: unknown[] = []
    await engine.prepare(p => seen.push(p))
    await engine.prepare()
    expect(FakeWorker.made).toHaveLength(1)
    expect(FakeWorker.made[0]!.got[0]).toMatchObject({
      t: 'load', kind: model.kind, base: `/models/${model.dir}`, runtime: `/models/runtime/${DEVICE_RUNTIME}/`, files: ['a.onnx', 'tokens.txt'],
    })
    expect(seen).toEqual([{ phase: 'fetch' }, { phase: 'fetch', got: 100, total: 110 }, { phase: 'fetch', got: 105, total: 110 }])
    const t = take()
    expect(await engine.transcribe(t, { terms: [], signal: new AbortController().signal })).toEqual({ text: 'bonjour', ms: 7 })
    expect(t.pcm.length).toBe(TAKE_RATE) // not detached
    engine.dispose()
    expect(FakeWorker.made[0]!.terminated).toBe(true)
  })

  it('decodes a long take piece by piece, with the text so far after each', async () => {
    const engine = make()
    const partial: string[] = []
    const abort = new AbortController()
    const long = { pcm: new Float32Array(TAKE_RATE * 45).fill(0.5), seconds: 45 }
    expect(await engine.transcribe(long, { terms: [], signal: abort.signal, onPartial: t => partial.push(t) }))
      .toEqual({ text: 'bonjour bonjour bonjour', ms: 21 })
    expect(partial).toEqual(['bonjour', 'bonjour bonjour', 'bonjour bonjour bonjour'])
    // Cancelled during the first piece: the next ones are never sent.
    const run = engine.transcribe(long, { terms: [], signal: abort.signal, onPartial: () => abort.abort() })
    expect(isAbortError(await run.catch(e => e))).toBe(true)
    await new Promise(r => setTimeout(r, 10))
    expect(FakeWorker.made[0]!.got.filter(m => m.t === 'decode')).toHaveLength(4)
  })

  it('downloads into Cache Storage before the worker reads it, or streams it when the quota is full', async () => {
    const caches = fakeCaches()
    const seen: unknown[] = []
    const engine = createDeviceEngine({ model, caches, fetch: rangeServer(model).fetch, worker: () => new FakeWorker() as unknown as Worker })
    await engine.prepare(p => seen.push(p))
    expect(seen.slice(0, 3)).toEqual([{ phase: 'fetch', got: 0, total: 110 }, { phase: 'fetch', got: 100, total: 110 }, { phase: 'fetch', got: 110, total: 110 }])
    expect(FakeWorker.made[0]!.got[0]).toMatchObject({ cache: DEVICE_CACHE, chunk: CHUNK, bytes: [100, 10] })
    vi.stubGlobal('Worker', FakeWorker)
    expect(await engine.readiness()).toEqual({ ready: true })

    const full = fakeCaches()
    const open = full.open.bind(full)
    full.open = async (n: string) => ({ ...(await open(n)), put: async () => { throw new DOMException('full', 'QuotaExceededError') } }) as unknown as Cache
    await createDeviceEngine({ model: { ...model, id: 'q' }, caches: full, fetch: rangeServer(model).fetch, worker: () => new FakeWorker() as unknown as Worker }).prepare()
    expect(FakeWorker.made[1]!.got[0]).toMatchObject({ cache: '' })
  })

  it('fails the load and starts a fresh worker on the next press', async () => {
    const engine = make({ loadError: 'out of memory' })
    await expect(engine.prepare()).rejects.toThrow('out of memory')
    await expect(engine.prepare()).rejects.toThrow('out of memory')
    expect(FakeWorker.made).toHaveLength(2)
    expect(FakeWorker.made[0]!.terminated).toBe(true)
  })

  it('rejects a load still running when disposed', async () => {
    const engine = make()
    const loading = engine.prepare()
    engine.dispose()
    expect(isAbortError(await loading.catch(e => e))).toBe(true)
  })

  describe('readiness', () => {
    const head = (status: number) => vi.fn(async () => new Response(null, { status }))
    const cachesWith = (hit: boolean) => ({ open: async () => ({ keys: async () => (hit ? model.files.map(f => ({ url: `http://x/models/${model.dir}/${f.path}` })) : []) }) }) as unknown as CacheStorage

    it('is ready when the model is cached, or when the server has it', async () => {
      vi.stubGlobal('Worker', FakeWorker)
      const fetch = head(404)
      expect(await createDeviceEngine({ model, caches: cachesWith(true), fetch }).readiness()).toEqual({ ready: true })
      expect(fetch).not.toHaveBeenCalled()
      expect(await createDeviceEngine({ model, caches: cachesWith(false), fetch: head(200) }).readiness()).toEqual({ ready: true })
    })

    it('names the missing file, or says offline', async () => {
      vi.stubGlobal('Worker', FakeWorker)
      expect(await createDeviceEngine({ model, caches: null, fetch: head(404) }).readiness())
        .toEqual({ ready: false, reason: 'not-installed', detail: `${model.name}: a.onnx (HTTP 404)` })
      const offline = vi.fn(async () => { throw new TypeError('offline') })
      expect(await createDeviceEngine({ model, caches: null, fetch: offline }).readiness()).toEqual({ ready: false, reason: 'offline' })
    })

    it('is unsupported without workers', async () => {
      vi.stubGlobal('Worker', undefined)
      expect(await createDeviceEngine({ model, caches: null }).readiness()).toEqual({ ready: false, reason: 'unsupported' })
    })
  })
})

describe('device models', () => {
  it('match what the fetch script downloads, Parakeet v3 by default', () => {
    for (const m of DEVICE_MODELS) {
      const [entry] = SETS[m.set]
      expect(entry.dir).toBe(m.dir)
      expect([...entry.members].sort()).toEqual(m.files.map(f => f.path).sort())
    }
    expect(SETS.runtime[0].to).toContain(`runtime/${DEVICE_RUNTIME}/`)
    expect(DEFAULT_SETS).toEqual(['runtime', DEVICE_MODELS[0]!.set])
    expect(DEVICE_MODELS[0]!.languages).toEqual(expect.arrayContaining(['fr', 'en']))
    expect(deviceModel('sensevoice').id).toBe('sensevoice')
    expect(deviceModel('gone').id).toBe('parakeet-v3')
  })
})
