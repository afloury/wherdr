import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DICTATION_MAX, OPENROUTER_URL, createDictation } from '../server/utils/dictation'

const KEY = 'sk-or-test-key-0000'
// A WAV header and 0.1 s of 16 kHz silence: all the relay checks is RIFF/WAVE.
const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'), Buffer.alloc(3200)])
let dir: string
let logs: unknown[][]

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dictation-'))
  logs = []
  for (const m of ['log', 'error', 'warn'] as const) vi.spyOn(console, m).mockImplementation((...a) => { logs.push(a) })
})
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }) })

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }))
const noKey = (v: unknown) => expect(JSON.stringify(v) + JSON.stringify(logs)).not.toContain(KEY)

describe('dictation key store', () => {
  it('saves the key 0600 and only ever shows its last 4 characters', () => {
    const d = createDictation({ dataDir: dir })
    expect(d.status()).toEqual({ set: false })
    const saved = d.saveKey(` ${KEY} `)
    expect(saved).toEqual({ set: true, last4: '0000' })
    noKey(saved)
    const file = path.join(dir, 'openrouter.json')
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).key).toBe(KEY)
    expect(d.deleteKey()).toEqual({ set: false })
    expect(fs.existsSync(file)).toBe(false)
  })

  it('refuses what is not a key, and the environment key wins', () => {
    const d = createDictation({ dataDir: dir, envKey: 'sk-or-test-key-1111' })
    expect(() => d.saveKey('short')).toThrow('does not look like')
    expect(() => d.saveKey(42)).toThrow()
    expect(d.status()).toEqual({ set: true, last4: '1111', env: true })
  })
})

describe('dictation relay', () => {
  it('sends base64 WAV, language, terms and ZDR, and returns the text', async () => {
    const fetch = answer(200, { text: ' hello wherdr ', usage: { seconds: 0.1, cost: 0.0000003 } })
    const d = createDictation({ dataDir: dir, fetch })
    d.saveKey(KEY)
    const out = await d.transcribe(wav, { model: 'mistralai/voxtral-mini-transcribe', language: 'fr', terms: 'wherdr\nclaude\n\n' })
    expect(out).toEqual({ text: 'hello wherdr', seconds: 0.1, cost: 0.0000003 })
    noKey(out)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(OPENROUTER_URL)
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ model: 'mistralai/voxtral-mini-transcribe', language: 'fr', keyterms: ['wherdr', 'claude'], provider: { zdr: true, data_collection: 'deny' } })
    expect(Buffer.from(body.input_audio.data, 'base64').equals(wav)).toBe(true)
  })

  it('falls back to the default model, drops a bad language, and turns ZDR off only when asked', async () => {
    const fetch = answer(200, { text: 'ok' })
    const d = createDictation({ dataDir: dir, fetch })
    d.saveKey(KEY)
    await d.transcribe(wav, { model: 'not a model', language: 'french', zdr: '0' })
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.model).toBe('openai/whisper-large-v3-turbo')
    expect(body.language).toBeUndefined()
    expect(body.keyterms).toBeUndefined()
    expect(body.provider).toEqual({ data_collection: 'deny' })
  })

  it('without a key, says so and calls nobody', async () => {
    const fetch = answer(200, {})
    await expect(createDictation({ dataDir: dir, fetch }).transcribe(wav, {})).rejects.toMatchObject({ code: 'no_key' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses more than 8 MB and what is not a WAV', async () => {
    const fetch = answer(200, {})
    const d = createDictation({ dataDir: dir, fetch })
    d.saveKey(KEY)
    const big = Buffer.concat([wav, Buffer.alloc(DICTATION_MAX)])
    await expect(d.transcribe(big, {})).rejects.toMatchObject({ code: 'too_large' })
    await expect(d.transcribe(Buffer.from('not audio at all'), {})).rejects.toMatchObject({ code: 'bad_audio' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('never lets the key out through an upstream error', async () => {
    const d = createDictation({ dataDir: dir, fetch: answer(401, { error: { message: `Invalid key ${KEY}` } }) })
    d.saveKey(KEY)
    const err = await d.transcribe(wav, {}).catch(e => e)
    expect(err.code).toBe('bad_key')
    expect(err.message).toContain('Invalid key')
    noKey(err.message)
    const down = createDictation({ dataDir: dir, fetch: vi.fn(async () => { throw new Error(`socket closed for ${KEY}`) }) })
    noKey((await down.transcribe(wav, {}).catch(e => e)).message)
  })

  it('cuts the OpenRouter request when the browser leaves, and after the timeout', async () => {
    let seen: AbortSignal | undefined
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, reject) => {
      seen = init.signal!
      seen.addEventListener('abort', () => reject(seen!.reason))
    }))
    const d = createDictation({ dataDir: dir, fetch: hang as unknown as typeof fetch })
    d.saveKey(KEY)
    const gone = new AbortController()
    const run = d.transcribe(wav, {}, gone.signal)
    await vi.waitFor(() => expect(seen).toBeDefined())
    gone.abort()
    await expect(run).rejects.toMatchObject({ code: 'aborted' })
    expect(seen!.aborted).toBe(true)

    const slow = createDictation({ dataDir: dir, fetch: hang as unknown as typeof fetch, timeoutMs: 20 })
    await expect(slow.transcribe(wav, {})).rejects.toMatchObject({ code: 'upstream', message: 'OpenRouter took too long' })
    noKey(logs)
  })
})
