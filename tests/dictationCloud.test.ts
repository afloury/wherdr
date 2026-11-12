import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runDictationEngineContract } from './dictationEngineContract'
import { cloudTranscribe, createCloudEngine } from '../app/utils/dictation/cloud'
import { CLOUD_DEFAULTS } from '../app/utils/dictation/cloudOptions'
import { encodeWav } from '../app/utils/dictation/wav'

// A server that never answers unless the signal aborts.
const hanging = (_u: string, init?: RequestInit) => new Promise<Response>((_r, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
})

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(hanging)) })

runDictationEngineContract('cloud', () => createCloudEngine())

const take = { pcm: new Float32Array([0, 0.5, -1, 2]), seconds: 0.00025 }

describe('cloud dictation engine', () => {
  it('posts the take as a WAV with model, ZDR and language, terms only when allowed', async () => {
    const fetch = vi.fn(async () => Response.json({ text: 'bonjour', cost: 0.000003 }))
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal
    const out = await cloudTranscribe(take, { language: 'fr', terms: ['wherdr', 'claude'], signal }, CLOUD_DEFAULTS)
    expect(out).toMatchObject({ text: 'bonjour', cost: 0.000003 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const q = new URL(url, 'http://x').searchParams
    expect(q.get('model')).toBe('openai/whisper-large-v3-turbo')
    expect(q.get('zdr')).toBe('1')
    expect(q.get('language')).toBe('fr')
    expect(q.has('terms')).toBe(false)
    expect((init.headers as Record<string, string>)['content-type']).toBe('audio/wav')
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(new Uint8Array(encodeWav(take.pcm)))

    await cloudTranscribe(take, { terms: ['wherdr', 'claude'], signal }, { ...CLOUD_DEFAULTS, zdr: false, terms: true })
    const q2 = new URL((fetch.mock.calls[1] as unknown as [string])[0], 'http://x').searchParams
    expect(q2.get('terms')).toBe('wherdr\nclaude')
    expect(q2.get('zdr')).toBe('0')
  })

  it('rejects with the server error, and reads readiness from the key status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'OpenRouter: No endpoints found' }, { status: 400 })))
    await expect(cloudTranscribe(take, { terms: [], signal: new AbortController().signal })).rejects.toThrow('No endpoints found')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ set: false })))
    expect(await createCloudEngine().readiness()).toEqual({ ready: false, reason: 'no-key' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ set: true, last4: '3f2a' })))
    expect(await createCloudEngine().readiness()).toEqual({ ready: true })
  })
})

describe('encodeWav', () => {
  it('writes a 16 kHz 16-bit mono header and clips samples', () => {
    const v = new DataView(encodeWav(new Float32Array([1, -1, 3])))
    expect(v.byteLength).toBe(44 + 6)
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint16(34, true)).toBe(16)
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([32767, -32768, 32767])
  })
})
