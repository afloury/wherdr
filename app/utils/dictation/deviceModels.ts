// The models the on-device engine can run. The data lives in models.json (the
// catalog: sizes, languages, published figures, from the model study WHR-318),
// which scripts/fetch-dictation-files.mjs reads too: a model of a known family
// is added there without code. Files go to DATA_DIR/models and are served by
// the /models/** route.
import catalog from './models.json'

// sherpa-onnx WASM runtime folder, under /models/runtime/.
export const DEVICE_RUNTIME = 'sherpa-onnx-679ff70'
// Cache Storage the model files are kept in (the service worker spares wherdr-asr-*).
export const DEVICE_CACHE = 'wherdr-asr-v1'

// The families the worker knows how to build (public/workers/dictation-worker.js).
export const DEVICE_KINDS = ['senseVoice', 'nemoTransducer'] as const
export type DeviceKind = typeof DEVICE_KINDS[number]
export type DeviceNeed = 'webgpu' | 'shader-f16'

export interface DeviceModel {
  id: string
  name: string
  kind: DeviceKind
  requires: DeviceNeed[]
  set: string // the fetch script's set
  dir: string // under /models/
  files: { path: string, bytes: number }[]
  source: { url: string, sha256: string } // the fetch script's pinned archive
  languages: string[] // ISO 639-1, all detected automatically
  punctuation: boolean
  quality: { lang: string, dataset: string, wer: number, source: string }[] // published WER, %
  speed?: { estimate: number, basis: string, source: string } // 1-5, until measured here
  license?: { id: string, url: string }
}

// A catalog entry of a family this build does not know is skipped, so a newer
// catalog never breaks an older app.
export function readCatalog(raw: { models: unknown[] }): DeviceModel[] {
  return (raw.models as DeviceModel[]).filter(m => (DEVICE_KINDS as readonly string[]).includes(m.kind))
}

export const DEVICE_MODELS: DeviceModel[] = readCatalog(catalog)

export const DEVICE_MODEL_KEY = 'dictationDeviceModel'

// The model this device uses: its saved choice if still offered, else the default.
export function deviceModel(saved: string | null | undefined): DeviceModel {
  return DEVICE_MODELS.find(m => m.id === saved) ?? DEVICE_MODELS[0]!
}

export const modelBytes = (m: DeviceModel) => m.files.reduce((n, f) => n + f.bytes, 0)

// Quality, 1 to 5, from the published word error rate for one language:
// FLEURS first, else MLS, else Common Voice. 'unsupported' when the model does
// not speak it, null when no figure is published.
const DATASETS = ['FLEURS', 'MLS', 'CV']
const WER_STEPS = [5, 7, 10, 15]
export function qualityRating(m: DeviceModel, lang: string) {
  if (!m.languages.includes(lang)) return 'unsupported' as const
  const figure = DATASETS.map(d => m.quality.find(q => q.lang === lang && q.dataset === d)).find(Boolean)
  if (!figure) return null
  const step = WER_STEPS.findIndex(s => figure.wer <= s)
  return { dots: step < 0 ? 1 : 5 - step, ...figure }
}

// What this browser offers to models that need the GPU.
export async function gpuFeatures(gpu = (globalThis.navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } } | undefined)?.gpu): Promise<DeviceNeed[]> {
  if (!gpu) return []
  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) return []
    return adapter.features.has('shader-f16') ? ['webgpu', 'shader-f16'] : ['webgpu']
  }
  catch { return [] }
}

// The models that can run here: one needing WebGPU is left out without it.
export const runnableModels = (have: DeviceNeed[], models = DEVICE_MODELS) =>
  models.filter(m => m.requires.every(r => have.includes(r)))
