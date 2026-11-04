// Dictation through OpenRouter (Settings › Conversation › Dictation › Online).
// The key lives on this server only: OPENROUTER_API_KEY, else
// DATA_DIR/openrouter.json (mode 0600). It is never sent back to a browser
// (status gives its last 4 characters) and never written to a log; upstream
// error text is scrubbed of it too. The browser sends a 16 kHz WAV, the server
// relays it as base64 to OpenRouter's transcription endpoint.
import fs from 'node:fs'
import path from 'node:path'
import { HerdrError } from './herdr'
import { createRateLimit } from './rateLimit'
import { DEFAULT_CLOUD_MODEL, FALLBACK_CLOUD_MODELS, sttModels, type DictationModel } from '../../shared/dictationModels'

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
// Only the transcription models (the filter is checked again in sttModels).
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=transcription'
// The model list is kept 6 hours; after a failed fetch, retried after a minute.
export const MODELS_TTL_MS = 6 * 3600_000
export const MODELS_RETRY_MS = 60_000
export const DICTATION_MAX = 8 * 1024 * 1024 // a 120 s take is 3.8 MB
export const DICTATION_TIMEOUT_MS = 60_000
// Takes relayed to OpenRouter at once (all clients), and per client per minute.
export const DICTATION_CONCURRENT = 2
export const DICTATION_PER_MINUTE = 10
const KEY_RE = /^[\x21-\x7E]{16,256}$/
const MODEL_RE = /^[\w.-]+\/[\w.:-]+$/
const LANG_RE = /^[a-z]{2}$/

export interface DictationStatus { set: boolean, last4?: string, env?: boolean }
export interface ModelList { models: DictationModel[], live: boolean }
export interface TranscribeParams { model?: string, language?: string, terms?: string, zdr?: string }

export function createDictation(o: { dataDir: string, envKey?: string, fetch?: typeof fetch, timeoutMs?: number, now?: () => number }) {
  const now = o.now || Date.now
  const perMinute = createRateLimit(DICTATION_PER_MINUTE, 60_000)
  let running = 0
  const file = path.join(o.dataDir, 'openrouter.json')
  const fileKey = (): string => {
    try {
      const k = JSON.parse(fs.readFileSync(file, 'utf8'))?.key
      return typeof k === 'string' ? k : ''
    } catch { return '' }
  }
  const key = () => o.envKey || fileKey()
  const scrub = (s: string) => { const k = key(); return k ? s.split(k).join('…') : s }

  function status(): DictationStatus {
    const k = key()
    return k ? { set: true, last4: k.slice(-4), ...(o.envKey ? { env: true } : {}) } : { set: false }
  }

  function saveKey(raw: unknown): DictationStatus {
    const k = typeof raw === 'string' ? raw.trim() : ''
    if (!KEY_RE.test(k)) throw new HerdrError('bad_key', 'This does not look like an OpenRouter key')
    fs.mkdirSync(o.dataDir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify({ key: k })}\n`, { mode: 0o600 })
    fs.renameSync(tmp, file)
    fs.chmodSync(file, 0o600)
    return status()
  }

  function deleteKey(): DictationStatus {
    fs.rmSync(file, { force: true })
    return status()
  }

  // `signal`: the browser went away (× or a closed tab): OpenRouter is cut too.
  // `client`: who sent the take (clientKey), for the per-minute limit.
  async function transcribe(wav: Buffer, p: TranscribeParams, signal?: AbortSignal, client = ''): Promise<{ text: string, seconds?: number, cost?: number }> {
    if (running >= DICTATION_CONCURRENT) throw new HerdrError('rate_limited', 'Too many dictations at once, try again in a moment')
    if (!perMinute.take(client)) throw new HerdrError('rate_limited', 'Too many dictations, wait a minute')
    running++
    try { return await relay(wav, p, signal) }
    finally { running-- }
  }

  async function relay(wav: Buffer, p: TranscribeParams, signal?: AbortSignal): Promise<{ text: string, seconds?: number, cost?: number }> {
    const k = key()
    if (!k) throw new HerdrError('no_key', 'No OpenRouter key on this server')
    if (wav.length > DICTATION_MAX) throw new HerdrError('too_large', 'Recording too large (8 MB max)')
    if (wav.toString('latin1', 0, 4) !== 'RIFF' || wav.toString('latin1', 8, 12) !== 'WAVE') throw new HerdrError('bad_audio', 'Not a WAV recording')
    const model = p.model && MODEL_RE.test(p.model) ? p.model : DEFAULT_CLOUD_MODEL
    const keyterms = (p.terms || '').split('\n').map(s => s.trim().slice(0, 100)).filter(Boolean).slice(0, 1000)
    const body = {
      model,
      input_audio: { data: wav.toString('base64'), format: 'wav' },
      ...(p.language && LANG_RE.test(p.language) ? { language: p.language } : {}),
      ...(keyterms.length ? { keyterms } : {}),
      // ZDR unless the browser turned it off: only providers that keep nothing.
      provider: p.zdr === '0' ? { data_collection: 'deny' } : { zdr: true, data_collection: 'deny' },
    }
    const timeout = AbortSignal.timeout(o.timeoutMs ?? DICTATION_TIMEOUT_MS)
    let r: Response
    try {
      r = await (o.fetch || fetch)(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${k}`, 'content-type': 'application/json', 'x-title': 'wherdr' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (e) {
      if (signal?.aborted) throw new HerdrError('aborted', 'Dictation cancelled')
      if (timeout.aborted) throw new HerdrError('upstream', 'OpenRouter took too long')
      throw new HerdrError('upstream', scrub(`OpenRouter unreachable: ${(e as Error)?.message || e}`))
    }
    const data = await r.json().catch(() => ({})) as { text?: unknown, usage?: { seconds?: unknown, cost?: unknown }, error?: { message?: unknown } }
    if (!r.ok) {
      const msg = typeof data.error?.message === 'string' ? data.error.message.slice(0, 300) : `HTTP ${r.status}`
      throw new HerdrError(r.status === 401 ? 'bad_key' : 'upstream', scrub(`OpenRouter: ${msg}`))
    }
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined
    return { text: typeof data.text === 'string' ? data.text.trim() : '', seconds: num(data.usage?.seconds), cost: num(data.usage?.cost) }
  }

  // OpenRouter's speech-to-text models, once a key is saved (nothing leaves
  // this server before). One fetch at a time; the last good list is kept
  // 6 hours and served stale while OpenRouter fails; with none, the fallback.
  let cache: { models: DictationModel[], at: number } | null = null
  let failedAt = -Infinity
  let pending: Promise<ModelList> | null = null
  async function models(): Promise<ModelList> {
    const k = key()
    if (!k) return { models: FALLBACK_CLOUD_MODELS, live: false }
    const t = now()
    if (cache && t - cache.at < MODELS_TTL_MS) return { models: cache.models, live: true }
    const stale = (): ModelList => cache ? { models: cache.models, live: true } : { models: FALLBACK_CLOUD_MODELS, live: false }
    if (t - failedAt < MODELS_RETRY_MS) return stale()
    pending ||= (async () => {
      try {
        const r = await (o.fetch || fetch)(OPENROUTER_MODELS_URL, {
          headers: { 'authorization': `Bearer ${k}`, 'x-title': 'wherdr' },
          signal: AbortSignal.timeout(o.timeoutMs ?? DICTATION_TIMEOUT_MS),
        })
        const list = r.ok ? sttModels(await r.json().catch(() => null)) : []
        if (!list.length) throw new Error(`HTTP ${r.status}`)
        cache = { models: list, at: now() }
        return { models: list, live: true }
      } catch {
        failedAt = now()
        return stale()
      }
    })().finally(() => { pending = null })
    return pending
  }

  return { status, saveKey, deleteKey, transcribe, models }
}
