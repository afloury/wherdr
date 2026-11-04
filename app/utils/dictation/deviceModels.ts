// The models the on-device engine can run, from the model study (WHR-318):
// Parakeet v3 is the French and English default, SenseVoice the lighter
// choice for English (no French). Their files are fetched into DATA_DIR/models
// by scripts/fetch-dictation-files.mjs (the same dir and files: a test checks
// it) and served by the /models/** route.

// sherpa-onnx WASM runtime folder, under /models/runtime/.
export const DEVICE_RUNTIME = 'sherpa-onnx-679ff70'
// Cache Storage the worker keeps model files in (the service worker spares wherdr-asr-*).
export const DEVICE_CACHE = 'wherdr-asr-v1'

export interface DeviceModel {
  id: string
  name: string
  kind: 'senseVoice' | 'nemoTransducer' // how the worker builds the recognizer
  dir: string // under /models/
  files: { path: string, bytes: number }[]
  languages: string[] // ISO 639-1, all detected automatically
  set: string // the fetch script's set
}

export const DEVICE_MODELS: DeviceModel[] = [
  {
    id: 'parakeet-v3',
    name: 'Parakeet v3',
    kind: 'nemoTransducer',
    dir: 'parakeet-tdt-0.6b-v3-int8',
    files: [
      { path: 'encoder.int8.onnx', bytes: 652_184_281 },
      { path: 'decoder.int8.onnx', bytes: 11_845_275 },
      { path: 'joiner.int8.onnx', bytes: 6_355_277 },
      { path: 'tokens.txt', bytes: 93_939 },
    ],
    languages: ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'uk'],
    set: 'parakeet',
  },
  {
    id: 'sensevoice',
    name: 'SenseVoice',
    kind: 'senseVoice',
    dir: 'sensevoice-zh-en-ja-ko-yue-2025-09',
    files: [
      { path: 'model.int8.onnx', bytes: 237_115_547 },
      { path: 'tokens.txt', bytes: 315_894 },
    ],
    languages: ['zh', 'en', 'ja', 'ko', 'yue'],
    set: 'sensevoice',
  },
]

export const DEVICE_MODEL_KEY = 'dictationDeviceModel'

// The model this device uses: its saved choice if still offered, else the default.
export function deviceModel(saved: string | null | undefined): DeviceModel {
  return DEVICE_MODELS.find(m => m.id === saved) ?? DEVICE_MODELS[0]!
}
