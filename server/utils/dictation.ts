// Dictation through OpenRouter (Settings › Conversation › Dictation › Online).
// The key lives on this server only: OPENROUTER_API_KEY, else
// DATA_DIR/openrouter.json (mode 0600). It is never sent back to a browser
// (status gives its last 4 characters) and never written to a log; upstream
// error text is scrubbed of it too. The browser sends a 16 kHz WAV, the server
// relays it as base64 to OpenRouter's transcription endpoint.
import fs from 'node:fs'
import path from 'node:path'
import { HerdrError } from './herdr'

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
export const DICTATION_MAX = 8 * 1024 * 1024 // a 120 s take is 3.8 MB
export const DICTATION_TIMEOUT_MS = 60_000
const KEY_RE = /^[\x21-\x7E]{16,256}$/
const MODEL_RE = /^[\w.-]+\/[\w.:-]+$/
const LANG_RE = /^[a-z]{2}$/

export interface DictationStatus { set: boolean, last4?: string, env?: boolean }
export interface TranscribeParams { model?: string, language?: string, terms?: string, zdr?: string }

export function createDictation(o: { dataDir: string, envKey?: string, fetch?: typeof fetch, timeoutMs?: number }) {
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
  async function transcribe(wav: Buffer, p: TranscribeParams, signal?: AbortSignal): Promise<{ text: string, seconds?: number, cost?: number }> {
    const k = key()
    if (!k) throw new HerdrError('no_key', 'No OpenRouter key on this server')
    if (wav.length > DICTATION_MAX) throw new HerdrError('too_large', 'Recording too large (8 MB max)')
    if (wav.toString('latin1', 0, 4) !== 'RIFF' || wav.toString('latin1', 8, 12) !== 'WAVE') throw new HerdrError('bad_audio', 'Not a WAV recording')
    const model = p.model && MODEL_RE.test(p.model) ? p.model : 'openai/whisper-large-v3-turbo'
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

  return { status, saveKey, deleteKey, transcribe }
}
