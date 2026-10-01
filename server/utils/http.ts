// HTTP helpers shared by the routes: anti-CSRF guard, body reading, error
// format identical to the old server.js ({ error, code } + 400/401/403/503).
import type { H3Event, EventHandlerRequest } from 'h3'
import { defineEventHandler, getRequestHeaders, readRawBody, setResponseHeader, setResponseStatus, getRequestURL } from 'h3'
import { createAuth, type ReqLike } from './auth'
import { DATA_DIR, PASSKEY_USER, log } from './env'
import { HerdrError } from './herdr'

export const auth = createAuth({ dataDir: DATA_DIR, log, passkeyUser: PASSKEY_USER })

export const reqOf = (event: H3Event): ReqLike => ({ headers: getRequestHeaders(event) as Record<string, string | undefined> })

// Anti-CSRF: writes require JSON (hence a CORS preflight we never
// satisfy) and an Origin identical to the host.
export function sameOrigin(headers: { origin?: string | null, host?: string | null }) {
  const o = headers.origin
  if (!o) return false
  try { return new URL(o).host === headers.host }
  catch { return false }
}

const BODY_MAX = 256 * 1024

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

// Error response, in the old server's format.
export function sendError(event: H3Event, status: number, body: Record<string, unknown>) {
  setResponseStatus(event, status)
  setResponseHeader(event, 'cache-control', 'no-store')
  return body
}

interface ApiOptions {
  // Binary body accepted (photos): MIME type checked by the expression.
  raw?: RegExp
}

// An API route: write checks, JSON body, known errors -> { error, code }.
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
        // Non-"simple" types (JSON, image/*): another site cannot send them
        // without a CORS preflight, which we never satisfy.
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
      // The lock routes set or clear the session cookie.
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

// Binary image (conversation or sent photo).
export function sendImage(event: H3Event, img: { type: string, body: Buffer }) {
  setResponseHeader(event, 'content-type', img.type)
  setResponseHeader(event, 'cache-control', 'private, max-age=86400')
  setResponseHeader(event, 'x-content-type-options', 'nosniff')
  // Opened alone in a tab, the image runs nothing.
  setResponseHeader(event, 'content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  return img.body
}
