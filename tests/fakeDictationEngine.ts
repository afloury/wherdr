// A dictation engine for tests: answers `text` after `delayMs`, honours its
// signal, and records what it was given.
import { abortError } from '../app/utils/dictation/engine'
import type { DictationEngine, Readiness, Take, TranscribeOptions } from '../app/utils/dictation/engine'

export interface FakeEngine extends DictationEngine {
  takes: Take[]
  calls: TranscribeOptions[]
  disposed: number
  // Set to hold prepare() until released (a model still loading).
  holdPrepare: () => () => void
}

export function createFakeEngine(o: { text?: string, delayMs?: number, readiness?: Readiness } = {}): FakeEngine {
  let gate: Promise<void> | null = null
  const engine: FakeEngine = {
    id: 'device',
    caps: { terms: true, languages: 'many', offline: true },
    takes: [],
    calls: [],
    disposed: 0,
    readiness: async () => o.readiness ?? { ready: true },
    prepare: async () => { await gate },
    holdPrepare() {
      let open!: () => void
      gate = new Promise(r => { open = r })
      return () => { gate = null; open() }
    },
    transcribe(take, opts) {
      engine.takes.push(take)
      engine.calls.push(opts)
      return new Promise((resolve, reject) => {
        if (opts.signal.aborted) return reject(abortError())
        const timer = setTimeout(() => resolve({ text: o.text ?? 'hello', ms: o.delayMs ?? 0 }), o.delayMs ?? 0)
        opts.signal.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()) }, { once: true })
      })
    },
    dispose() { engine.disposed++ },
  }
  return engine
}
