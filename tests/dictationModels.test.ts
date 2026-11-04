import { describe, expect, it } from 'vitest'
import { DEFAULT_CLOUD_MODEL, sttModels } from '../shared/dictationModels'

const STT = { input_modalities: ['audio'], output_modalities: ['transcription'] }
const ENDPOINT = ['/api/v1/audio/transcriptions']
// Trimmed entries in the shape of OpenRouter's GET /api/v1/models.
const MODELS_ANSWER = {
  data: [
    { id: 'qwen/qwen3-asr-1.7b', name: 'Qwen: Qwen3 ASR 1.7B', architecture: STT, pricing: { prompt: '0.0000075', completion: '0' }, endpoints: ENDPOINT },
    { id: 'openai/gpt-4o-mini-transcribe', name: 'OpenAI: GPT-4o Mini Transcribe', architecture: STT, pricing: { prompt: '0.00000125', completion: '0.000005' }, endpoints: ENDPOINT },
    { id: DEFAULT_CLOUD_MODEL, name: 'OpenAI: Whisper Large V3 Turbo', architecture: STT, pricing: { prompt: '0.00000333', completion: '0' }, endpoints: ENDPOINT },
    { id: 'microsoft/mai-transcribe-2', name: 'Microsoft AI: MAI-Transcribe 2', architecture: STT, pricing: { prompt: '0.1', completion: '0' }, endpoints: ENDPOINT },
    // A chat model that accepts audio: it answers text, not at the transcription endpoint.
    { id: 'mistralai/voxtral-small-24b-2507', name: 'Mistral: Voxtral Small 24B', architecture: { input_modalities: ['text', 'audio'], output_modalities: ['text'] }, pricing: { prompt: '0.0000001', completion: '0.0000003' }, endpoints: ['/api/v1/chat/completions'] },
    // Says transcription but is not served at the endpoint the relay calls.
    { id: 'acme/odd-stt', name: 'Acme', architecture: STT, pricing: { prompt: '0.00001' }, endpoints: ['/api/v1/chat/completions'] },
    { id: 'not a slug', name: 'Bad id', architecture: STT, endpoints: ENDPOINT },
    { id: 'openai/gpt-5', name: 'GPT-5', architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  ],
}

describe('sttModels', () => {
  it('keeps only speech-to-text models served at the transcription endpoint', () => {
    expect(sttModels(MODELS_ANSWER).map(m => m.id)).toEqual([
      DEFAULT_CLOUD_MODEL, 'qwen/qwen3-asr-1.7b', 'microsoft/mai-transcribe-2', 'openai/gpt-4o-mini-transcribe',
    ])
  })

  it('gives a price per minute only for duration-priced models', () => {
    const byId = Object.fromEntries(sttModels(MODELS_ANSWER).map(m => [m.id, m]))
    expect(byId[DEFAULT_CLOUD_MODEL]).toEqual({ id: DEFAULT_CLOUD_MODEL, name: 'OpenAI: Whisper Large V3 Turbo', perMinute: 0.0002 })
    expect(byId['qwen/qwen3-asr-1.7b']!.perMinute).toBe(0.00045)
    // Billed per output token, or a price that cannot be per second: none shown.
    expect(byId['openai/gpt-4o-mini-transcribe']!.perMinute).toBeUndefined()
    expect(byId['microsoft/mai-transcribe-2']!.perMinute).toBeUndefined()
  })

  it('accepts an answer without endpoints and refuses junk', () => {
    expect(sttModels({ data: [{ id: 'a/b', architecture: STT }] })).toEqual([{ id: 'a/b', name: 'a/b' }])
    expect(sttModels(null)).toEqual([])
    expect(sttModels({ data: 'x' })).toEqual([])
    expect(sttModels({ data: [null, 1, { id: 'a/b', architecture: { input_modalities: 'audio' } }] })).toEqual([])
  })
})
