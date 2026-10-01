// Outils HTTP communs aux routes : garde anti-CSRF, lecture du corps, format
// d'erreur identique à l'ancien server.js ({ error, code } + 400/401/403/503).
import type { H3Event, EventHandlerRequest } from 'h3'
import { defineEventHandler, getRequestHeaders, readRawBody, setResponseHeader, setResponseStatus, getRequestURL } from 'h3'
import { createAuth, type ReqLike } from './auth'
import { DATA_DIR, PASSKEY_USER, log } from './env'
import { HerdrError } from './herdr'

export const auth = createAuth({ dataDir: DATA_DIR, log, passkeyUser: PASSKEY_USER })

export const reqOf = (event: H3Event): ReqLike => ({ headers: getRequestHeaders(event) as Record<string, string | undefined> })

// Anti-CSRF : les écritures exigent du JSON (donc un preflight CORS qu'on ne
// satisfait jamais) et une Origin identique à l'hôte.
export function sameOrigin(headers: { origin?: string | null, host?: string | null }) {
  const o = headers.origin
  if (!o) return false
  try { return new URL(o).host === headers.host }
  catch { return false }
}

const BODY_MAX = 256 * 1024

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

// Réponse d'erreur, au format de l'ancien serveur.
export function sendError(event: H3Event, status: number, body: Record<string, unknown>) {
  setResponseStatus(event, status)
  setResponseHeader(event, 'cache-control', 'no-store')
  return body
}

interface ApiOptions {
  // Corps binaire accepté (photos) : type MIME vérifié par l'expression.
  raw?: RegExp
}

// Une route d'API : vérifs d'écriture, corps JSON, erreurs connues -> { error, code }.
export function defineApi<T>(
  fn: (event: H3Event<EventHandlerRequest>, body: Json) => Promise<T> | T,
  opts: ApiOptions = {},
) {
  return defineEventHandler(async (event) => {
    const url = getRequestURL(event)
    try {
      let body: Json = {}
      if (event.method === 'POST') {
        const headers = getRequestHeaders(event)
        const ctype = String(headers['content-type'] || '')
        // Types non « simples » (JSON, image/*) : un autre site ne peut pas les
        // envoyer sans preflight CORS, qu'on ne satisfait jamais.
        const typeOk = opts.raw ? opts.raw.test(ctype) : ctype.startsWith('application/json')
        if (!sameOrigin(headers) || !typeOk) return sendError(event, 403, { error: 'Origin refused' })
        const max = opts.raw ? 20 * 1024 * 1024 : BODY_MAX
        if (Number(headers['content-length'] || 0) > max) {
          throw new HerdrError('too_large', opts.raw ? 'Image too large (20 MB max)' : 'Request too large')
        }
        const raw = await readRawBody(event, false)
        if (raw && raw.length > max) throw new HerdrError('too_large', opts.raw ? 'Image too large (20 MB max)' : 'Request too large')
        if (opts.raw) body = { data: raw || Buffer.alloc(0), ctype }
        else {
          try { body = raw && raw.length ? JSON.parse(raw.toString('utf8')) : {} }
          catch { throw new HerdrError('bad_json', 'Invalid JSON') }
        }
      }
      const out = await fn(event, body)
      setResponseHeader(event, 'cache-control', 'no-store')
      // Les routes de verrouillage posent ou effacent le cookie de session.
      if (out && typeof out === 'object' && '__cookie' in out) {
        const o = out as Record<string, unknown>
        setResponseHeader(event, 'set-cookie', String(o.__cookie))
        delete o.__cookie
      }
      return out
    } catch (e) {
      const err = e as Error & { code?: string }
      const known = e instanceof HerdrError || (url.pathname.startsWith('/api/auth/') && Boolean(err.code))
      const code = known ? err.code : 'internal'
      if (!known) log('erreur', event.method, url.pathname, e)
      const status = err.code === 'unreachable' ? 503 : err.code === 'locked' ? 401 : 400
      return sendError(event, status, { error: err.message, code })
    }
  })
}

// Image binaire (conversation ou photo envoyée).
export function sendImage(event: H3Event, img: { type: string, body: Buffer }) {
  setResponseHeader(event, 'content-type', img.type)
  setResponseHeader(event, 'cache-control', 'private, max-age=86400')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  // Ouverte seule dans un onglet, l'image n'exécute rien.
  setResponseHeader(event, 'content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  return img.body
}
