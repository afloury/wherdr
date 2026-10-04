// Passkey lock (WebAuthn: Face ID on iPhone, Touch ID on
// Mac). As long as no key is registered, the app stays open (the tailnet
// is the only door). From the first one on, all access to agents requires an
// unlocked session: signed cookie, valid for 12 h after the last use (sliding:
// an authenticated request more than RENEW_MS after the cookie was issued
// gets a fresh 12 h cookie). Only 12 h without any request locks the app.
//
// The cookie also carries the time of the passkey unlock ("since"), which the
// slide never moves. Past since + the maximum duration set in Settings, the
// session ends when the app opens or comes back to the foreground (status
// with `resume`), never in the middle of use; a client that never reopens is
// cut SESSION_MS later at the latest.
//
// data/auth.json: signing secret, registered keys (public key +
// counter), generation number (incremented when disabling or locking every
// device: all current sessions become invalid), maximum session duration.
// Lost key: deleting data/auth.json on the server reopens the app.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import type { AuthStatus } from '../../shared/types'
import { DAY_MS, DEFAULT_MAX_SESSION_DAYS, isMaxSessionDays, type MaxSessionDays } from '../../shared/sessionLimit'

const SESSION_MS = 12 * 3600 * 1000
// Minimum age of a session cookie before it is re-issued (limits Set-Cookie churn).
const RENEW_MS = 10 * 60 * 1000
const CHALLENGE_MS = 5 * 60 * 1000
export const AUTH_COOKIE = 'hw_session'
const CHALLENGE_COOKIE = 'hw_challenge'

// The useful headers of an HTTP request or a WebSocket upgrade request.
export interface ReqLike { headers: Record<string, string | undefined> }

interface Credential {
  id: string
  publicKey: string
  counter: number
  transports: AuthenticatorTransportFuture[]
  name: string
  createdAt: string
  lastUsed?: string
}
interface AuthDb { secret: string | null, generation: number, credentials: Credential[], maxSessionDays?: MaxSessionDays }

export class AuthError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export function createAuth({ dataDir, log = () => {}, passkeyUser = 'herdr' }: { dataDir: string, log?: (...a: unknown[]) => void, passkeyUser?: string }) {
  const FILE = path.join(dataDir, 'auth.json')
  let db: AuthDb = { secret: null, generation: 0, credentials: [] }
  try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) } }
  catch { /* no file yet */ }
  const save = () => {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 })
  }
  if (!db.secret) {
    db.secret = crypto.randomBytes(32).toString('hex')
    save()
  }

  // Temporary token, renewed at each startup and only visible in the logs.
  const bootstrapToken = crypto.randomBytes(24).toString('base64url')
  if (!db.credentials.length) log(`First passkey: bootstrap token ${bootstrapToken}`)

  const enabled = () => db.credentials.length > 0
  const sign = (v: string) => crypto.createHmac('sha256', db.secret!).update(v).digest('base64url')
  const safeEq = (a: string, b: string) => {
    const x = Buffer.from(String(a))
    const y = Buffer.from(String(b))
    return x.length === y.length && crypto.timingSafeEqual(x, y)
  }
  const readCookie = (req: ReqLike) => {
    const c = String(req.headers.cookie || '').split(/;\s*/).find(s => s.startsWith(`${AUTH_COOKIE}=`))
    if (!c) return null
    // Damaged cookie ("%E0"…): simply no session, never a 500 error.
    try { return decodeURIComponent(c.slice(AUTH_COOKIE.length + 1)) }
    catch { return null }
  }
  const challengeClient = (req: ReqLike) => {
    const c = String(req.headers.cookie || '').split(/;\s*/).find(s => s.startsWith(`${CHALLENGE_COOKIE}=`))
    return c?.slice(CHALLENGE_COOKIE.length + 1) || null
  }
  const checkBootstrap = (body: Json) => {
    if (!enabled() && !safeEq(String(body?.bootstrapToken || ''), bootstrapToken)) {
      throw new AuthError('bootstrap', 'Invalid bootstrap token (see the server logs)')
    }
  }

  const maxSessionMs = () => (db.maxSessionDays ?? DEFAULT_MAX_SESSION_DAYS) * DAY_MS
  // A valid session cookie (expiry, passkey unlock time), or null. Cookies from
  // before the unlock time was recorded (exp.gen.mac) count from their issue.
  function session(req: ReqLike, now = Date.now()): { exp: number, since: number } | null {
    const v = readCookie(req)
    if (!v) return null
    const parts = v.split('.')
    if (parts.length !== 3 && parts.length !== 4) return null
    const mac = parts.pop()!
    if (!mac || parts[1] !== String(db.generation) || !safeEq(mac, sign(parts.join('.')))) return null
    const exp = Number(parts[0])
    const since = parts.length === 3 ? Number(parts[2]) : exp - SESSION_MS
    if (!(exp >= now) || !Number.isFinite(since)) return null
    // Backstop for clients that never reopen: the deadline plus one idle period.
    if (now > since + maxSessionMs() + SESSION_MS) return null
    return { exp, since }
  }
  function isUnlocked(req: ReqLike): boolean {
    return !enabled() || session(req) !== null
  }

  // Secure only over HTTPS (tailscale serve): tests on http://localhost
  // must also be able to set the cookie.
  const secure = (req: ReqLike) => (req.headers['x-forwarded-proto'] === 'https'
    || String(req.headers.origin || '').startsWith('https://')
    ? '; Secure'
    : '')
  function sessionCookie(req: ReqLike, now = Date.now(), since = now) {
    const exp = now + SESSION_MS
    const payload = `${exp}.${db.generation}.${since}`
    return `${AUTH_COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure(req)}`
  }
  const clearCookie = (req: ReqLike) => `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(req)}`

  // Sliding session: a valid cookie issued more than RENEW_MS ago is replaced
  // by a fresh one, keeping its unlock time. Returns the Set-Cookie value and
  // the new expiry, or null.
  function renew(req: ReqLike, now = Date.now()): { cookie: string, expiresAt: number } | null {
    if (!enabled()) return null
    const s = session(req, now)
    if (s === null || s.exp - now > SESSION_MS - RENEW_MS) return null
    return { cookie: sessionCookie(req, now, s.since), expiresAt: now + SESSION_MS }
  }

  // Relying party (rpID) = the page's host name (e.g. <host>.ts.net).
  function relying(req: ReqLike) {
    const origin = String(req.headers.origin || '')
    const { hostname } = new URL(origin)
    return { origin, rpID: hostname }
  }

  const challenges = new Map<string, { value: string, exp: number }>()
  const challengeKey = (kind: 'reg' | 'auth', client: string) => `${kind}:${client}`
  const issueChallenge = (req: ReqLike, kind: 'reg' | 'auth', value: string) => {
    const client = crypto.randomBytes(24).toString('base64url')
    for (const [key, challenge] of challenges) if (challenge.exp < Date.now()) challenges.delete(key)
    challenges.set(challengeKey(kind, client), { value, exp: Date.now() + CHALLENGE_MS })
    return `${CHALLENGE_COOKIE}=${client}; Path=/api/auth/; HttpOnly; SameSite=Strict; Max-Age=${CHALLENGE_MS / 1000}${secure(req)}`
  }
  const takeChallenge = (req: ReqLike, kind: 'reg' | 'auth') => {
    const client = challengeClient(req)
    const key = challengeKey(kind, client || '')
    const c = challenges.get(key)
    challenges.delete(key)
    if (!c || c.exp < Date.now()) throw new AuthError('challenge', 'Challenge expired, try again')
    return c.value
  }

  async function registerOptions(req: ReqLike, body: Json = {}) {
    if (enabled() && !isUnlocked(req)) throw new AuthError('locked', 'Unlock first')
    checkBootstrap(body)
    const { rpID } = relying(req)
    const opts = await generateRegistrationOptions({
      rpName: 'wherdr', rpID, userName: passkeyUser, userDisplayName: passkeyUser,
      attestationType: 'none',
      excludeCredentials: db.credentials.map(c => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    })
    return { ...opts, __cookie: issueChallenge(req, 'reg', opts.challenge) }
  }

  async function registerVerify(req: ReqLike, body: Json) {
    if (enabled() && !isUnlocked(req)) throw new AuthError('locked', 'Unlock first')
    checkBootstrap(body)
    const { origin, rpID } = relying(req)
    const v = await verifyRegistrationResponse({
      response: body.response, expectedChallenge: takeChallenge(req, 'reg'),
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    })
    if (!v.verified || !v.registrationInfo) throw new AuthError('rejected', 'Key rejected')
    const { credential } = v.registrationInfo
    db.credentials.push({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports || [],
      name: String(body.name || 'Device').slice(0, 40),
      createdAt: new Date().toISOString(),
    })
    save()
    log(`lock: key registered (${db.credentials.length})`)
    return { ok: true, __cookie: sessionCookie(req) }
  }

  async function loginOptions(req: ReqLike) {
    const { rpID } = relying(req)
    const opts = await generateAuthenticationOptions({
      rpID, userVerification: 'required',
      allowCredentials: db.credentials.map(c => ({ id: c.id, transports: c.transports })),
    })
    return { ...opts, __cookie: issueChallenge(req, 'auth', opts.challenge) }
  }

  async function loginVerify(req: ReqLike, body: Json) {
    const { origin, rpID } = relying(req)
    const cred = db.credentials.find(c => c.id === (body.response && body.response.id))
    if (!cred) throw new AuthError('unknown_key', 'Key unknown on this server')
    const v = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge: takeChallenge(req, 'auth'),
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: cred.id, publicKey: Buffer.from(cred.publicKey, 'base64url'), counter: cred.counter, transports: cred.transports },
    })
    if (!v.verified) throw new AuthError('rejected', 'Unlock rejected')
    cred.counter = v.authenticationInfo.newCounter
    cred.lastUsed = new Date().toISOString()
    save()
    return { ok: true, __cookie: sessionCookie(req) }
  }

  function disable(req: ReqLike) {
    if (!isUnlocked(req)) throw new AuthError('locked', 'Unlock first')
    db.credentials = []
    db.generation += 1
    save()
    log('lock disabled')
    return { ok: true, __cookie: clearCookie(req) }
  }

  // Lost or stolen device: every session ends (this one included), the keys stay.
  function lockAll(req: ReqLike) {
    if (!enabled() || !isUnlocked(req)) throw new AuthError('locked', 'Unlock first')
    db.generation += 1
    save()
    log('lock: all devices locked')
    return { ok: true, __cookie: clearCookie(req) }
  }

  function setMaxSession(req: ReqLike, days: unknown) {
    if (!enabled() || !isUnlocked(req)) throw new AuthError('locked', 'Unlock first')
    if (!isMaxSessionDays(days)) throw new AuthError('invalid', 'Invalid duration')
    db.maxSessionDays = days
    save()
    return { ok: true, maxSessionDays: days }
  }

  // Lock state; `resume` = the app opens or comes back to the foreground: a
  // session past its maximum duration ends here. Also slides the session.
  function status(req: ReqLike, { resume = false, now = Date.now() } = {}): AuthStatus & { __cookie?: string } {
    const devices = db.credentials.map(c => ({ name: c.name, createdAt: c.createdAt, lastUsed: c.lastUsed || null }))
    if (!enabled()) return { enabled: false, unlocked: true, devices }
    const s = session(req, now)
    const deadline = s ? s.since + maxSessionMs() : 0
    if (!s || (resume && now >= deadline)) {
      return { enabled: true, unlocked: false, expiresAt: null, now, devices, ...(s ? { __cookie: clearCookie(req) } : {}) }
    }
    const renewed = renew(req, now)
    return {
      enabled: true, unlocked: true, expiresAt: renewed?.expiresAt ?? s.exp, deadline, now,
      maxSessionDays: db.maxSessionDays ?? DEFAULT_MAX_SESSION_DAYS, devices,
      ...(renewed ? { __cookie: renewed.cookie } : {}),
    }
  }

  return {
    isUnlocked, status, renew, registerOptions, registerVerify, loginOptions, loginVerify, disable, lockAll, setMaxSession,
    lock: (req: ReqLike) => ({ ok: true, __cookie: clearCookie(req) }),
    // For tests.
    _sessionCookie: sessionCookie,
    _db: () => db,
    _bootstrapToken: () => bootstrapToken,
    _takeChallenge: takeChallenge,
  }
}

export type Auth = ReturnType<typeof createAuth>
