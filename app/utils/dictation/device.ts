// The on-device engine: sherpa-onnx WASM in a worker (public/workers/
// dictation-worker.js), on the CPU. The model files come from the wherdr
// server (/models/**) once, then from Cache Storage. Nothing leaves the device.
import { splitTake } from './audio'
import { abortError } from './engine'
import type { DictationEngine, PrepareProgress, Readiness } from './engine'
import { DEVICE_CACHE, DEVICE_MODEL_KEY, DEVICE_RUNTIME, deviceModel } from './deviceModels'
import type { DeviceModel } from './deviceModels'

export const WORKER_URL = '/workers/dictation-worker.js'

export interface DeviceEngineDeps {
  model?: DeviceModel
  worker?: () => Worker
  caches?: CacheStorage | null
  fetch?: typeof fetch
}

type FromWorker =
  | { t: 'phase', phase: string }
  | { t: 'dl', file: string, got: number, total: number }
  | { t: 'ready', ms: number, heap: number }
  | { t: 'final', id: number, text: string, ms: number, heap: number }
  | { t: 'error', id?: number, error: string }

interface Pending { resolve: (r: { text: string, ms: number }) => void, reject: (e: unknown) => void }

function savedModel(): DeviceModel {
  try { return deviceModel(localStorage.getItem(DEVICE_MODEL_KEY)) }
  catch { return deviceModel(null) }
}

export function createDeviceEngine(deps: DeviceEngineDeps = {}): DictationEngine {
  const model = deps.model ?? savedModel()
  const cacheStorage = deps.caches === undefined ? globalThis.caches : deps.caches
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const makeWorker = deps.worker ?? (() => new Worker(WORKER_URL))
  const urlOf = (path: string) => `/models/${model.dir}/${path}`
  const total = model.files.reduce((n, f) => n + f.bytes, 0)

  let worker: Worker | null = null
  let loading: Promise<void> | null = null
  let failLoad: ((err: Error) => void) | null = null
  let onProgress: ((p: PrepareProgress) => void) | undefined
  let nextId = 0
  const pending = new Map<number, Pending>()

  // The worker failed (load error, crash, out of memory): everything waiting
  // on it fails, and the next prepare starts a fresh one.
  function reset(err: Error) {
    worker?.terminate()
    worker = null
    loading = null
    failLoad?.(err)
    failLoad = null
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }

  function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = makeWorker()
      worker = w
      failLoad = reject
      const fail = (err: Error) => { if (worker === w) reset(err); reject(err) }
      w.onerror = (e) => { e.preventDefault?.(); fail(new Error(e.message || 'dictation worker failed')) }
      w.onmessage = ({ data: m }: MessageEvent<FromWorker>) => {
        if (m.t === 'phase') onProgress?.({ phase: m.phase })
        else if (m.t === 'dl') {
          const i = model.files.findIndex(f => f.path === m.file)
          const before = model.files.slice(0, Math.max(0, i)).reduce((n, f) => n + f.bytes, 0)
          onProgress?.({ phase: 'fetch', got: before + m.got, total })
        }
        else if (m.t === 'ready') { failLoad = null; resolve() }
        else if (m.t === 'final') {
          pending.get(m.id)?.resolve({ text: m.text, ms: m.ms })
          pending.delete(m.id)
        }
        else if (m.id === undefined) fail(new Error(m.error))
        else {
          pending.get(m.id)?.reject(new Error(m.error))
          pending.delete(m.id)
        }
      }
      w.postMessage({
        t: 'load',
        runtime: `/models/runtime/${DEVICE_RUNTIME}/`,
        base: `/models/${model.dir}`,
        kind: model.kind,
        files: model.files.map(f => f.path),
        cache: DEVICE_CACHE,
      })
    })
  }

  async function cached(): Promise<boolean> {
    if (!cacheStorage) return false
    const cache = await cacheStorage.open(DEVICE_CACHE)
    const hits = await Promise.all(model.files.map(f => cache.match(urlOf(f.path))))
    return hits.every(Boolean)
  }

  // One piece to the worker; a copy, so the caller keeps its take. A cancelled
  // piece's answer is dropped when it comes (a decode cannot be stopped).
  function decode(pcm: Float32Array, signal: AbortSignal): Promise<{ text: string, ms: number }> {
    if (!worker) return Promise.reject(abortError()) // disposed meanwhile
    const id = ++nextId
    const result = new Promise<{ text: string, ms: number }>((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
    const copy = pcm.slice()
    worker.postMessage({ t: 'decode', id, pcm: copy.buffer }, [copy.buffer])
    signal.addEventListener('abort', () => pending.delete(id), { once: true })
    return result
  }

  function prepare(progress?: (p: PrepareProgress) => void): Promise<void> {
    onProgress = progress
    if (!loading) {
      loading = start()
      loading.catch(() => {}) // a dispose with no take waiting
    }
    return loading
  }

  return {
    id: 'device',
    caps: { terms: false, languages: model.languages, offline: true },

    async readiness(): Promise<Readiness> {
      if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return { ready: false, reason: 'unsupported' }
      if (await cached().catch(() => false)) return { ready: true }
      // Not on this device yet: prepare downloads it if the server has it.
      try {
        const heads = await Promise.all(model.files.map(f => doFetch(urlOf(f.path), { method: 'HEAD' })))
        const missing = heads.findIndex(r => !r.ok)
        if (missing < 0) return { ready: true }
        return { ready: false, reason: 'not-installed', detail: `${model.name}: ${model.files[missing]!.path} (HTTP ${heads[missing]!.status})` }
      }
      catch {
        return { ready: false, reason: 'offline' }
      }
    },

    prepare,

    // A long take is decoded piece by piece (splitTake): each piece reports
    // the text so far, and a cancel stops before the next piece.
    async transcribe(take, opts) {
      if (opts.signal.aborted) throw abortError()
      const aborted = new Promise<never>((_, reject) => {
        opts.signal.addEventListener('abort', () => reject(abortError()), { once: true })
      })
      aborted.catch(() => {})
      await Promise.race([prepare(onProgress), aborted])
      let text = ''
      let ms = 0
      for (const piece of splitTake(take.pcm)) {
        if (opts.signal.aborted) throw abortError()
        const r = await Promise.race([decode(piece, opts.signal), aborted])
        text = [text, r.text].filter(Boolean).join(' ')
        ms += r.ms
        opts.onPartial?.(text)
      }
      return { text, ms }
    },

    dispose() {
      if (worker) reset(abortError())
    },
  }
}
