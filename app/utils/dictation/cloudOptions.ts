// Settings › Dictation › Online, kept on this device like the engine choice.
// Only the key is shared: it lives on the wherdr server.
export interface CloudOptions { model: string, zdr: boolean, terms: boolean }

export const CLOUD_OPTIONS_KEY = 'dictationCloud'
export const CLOUD_MODELS = [
  { value: 'openai/whisper-large-v3-turbo', label: 'Whisper large v3 turbo' },
  { value: 'mistralai/voxtral-mini-transcribe', label: 'Voxtral Mini' },
  { value: 'openai/gpt-4o-mini-transcribe', label: 'GPT-4o mini transcribe' },
]
// ZDR on, pane terms off: nothing beyond the audio leaves until asked.
export const CLOUD_DEFAULTS: CloudOptions = { model: CLOUD_MODELS[0]!.value, zdr: true, terms: false }

export function readCloudOptions(): CloudOptions {
  try {
    const o = JSON.parse(localStorage.getItem(CLOUD_OPTIONS_KEY) || '{}')
    return {
      model: typeof o.model === 'string' && o.model ? o.model : CLOUD_DEFAULTS.model,
      zdr: o.zdr !== false,
      terms: o.terms === true,
    }
  } catch { return { ...CLOUD_DEFAULTS } }
}

export function writeCloudOptions(o: CloudOptions): void {
  try { localStorage.setItem(CLOUD_OPTIONS_KEY, JSON.stringify(o)) }
  catch { /* storage unavailable */ }
}
