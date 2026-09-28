// Verrouillage par clé d'accès (WebAuthn : Face ID sur iPhone, Touch ID sur
// Mac). Tant qu'aucune clé n'est enregistrée, l'app reste ouverte (le tailnet
// est la seule porte). Dès la première, tout l'accès aux agents exige une
// session déverrouillée : cookie signé, valable 12 h.
//
// data/auth.json : secret de signature, clés enregistrées (clé publique +
// compteur), numéro de génération (incrémenté quand on désactive : toutes les
// sessions en cours deviennent invalides).
// Clé perdue : supprimer data/auth.json sur le serveur rouvre l'app.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server'
import type { AuthStatus } from '../../shared/types'

const SESSION_MS = 12 * 3600 * 1000
const CHALLENGE_MS = 5 * 60 * 1000
export const AUTH_COOKIE = 'hw_session'
const CHALLENGE_COOKIE = 'hw_challenge'

// Les en-têtes utiles d'une requête HTTP ou d'une demande de WebSocket.
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
interface AuthDb { secret: string | null, generation: number, credentials: Credential[] }

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
  catch { /* pas encore de fichier */ }
  const save = () => {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 })
  }
  if (!db.secret) {
    db.secret = crypto.randomBytes(32).toString('hex')
    save()
  }

  // Jeton temporaire, renouvelé à chaque démarrage et visible uniquement dans les journaux.
  const bootstrapToken = crypto.randomBytes(24).toString('base64url')
  if (!db.credentials.length) log(`Première clé d'accès : jeton d'amorçage ${bootstrapToken}`)

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
    // Cookie abîmé (« %E0 »…) : simplement pas de session, jamais une erreur 500.
    try { return decodeURIComponent(c.slice(AUTH_COOKIE.length + 1)) }
    catch { return null }
  }
  const challengeClient = (req: ReqLike) => {
    const c = String(req.headers.cookie || '').split(/;\s*/).find(s => s.startsWith(`${CHALLENGE_COOKIE}=`))
    return c?.slice(CHALLENGE_COOKIE.length + 1) || null
  }
  const checkBootstrap = (body: Json) => {
    if (!enabled() && !safeEq(String(body?.bootstrapToken || ''), bootstrapToken)) {
      throw new AuthError('bootstrap', 'jeton d’amorçage invalide (voir les journaux du serveur)')
    }
  }

  function isUnlocked(req: ReqLike): boolean {
    if (!enabled()) return true
    const v = readCookie(req)
    if (!v) return false
    const [exp, gen, mac] = v.split('.')
    if (!exp || !mac || Number(exp) < Date.now() || gen !== String(db.generation)) return false
    return safeEq(mac, sign(`${exp}.${gen}`))
  }

  // Secure seulement en HTTPS (tailscale serve) : les tests en http://localhost
  // doivent aussi pouvoir poser le cookie.
  const secure = (req: ReqLike) => (req.headers['x-forwarded-proto'] === 'https'
    || String(req.headers.origin || '').startsWith('https://')
    ? '; Secure'
    : '')
  function sessionCookie(req: ReqLike, now = Date.now()) {
    const exp = now + SESSION_MS
    const v = `${exp}.${db.generation}.${sign(`${exp}.${db.generation}`)}`
    return `${AUTH_COOKIE}=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure(req)}`
  }
  const clearCookie = (req: ReqLike) => `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(req)}`

  // Partie relais (rpID) = le nom d'hôte de la page (ex. <hôte>.ts.net).
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
    if (!c || c.exp < Date.now()) throw new AuthError('challenge', 'défi expiré, recommence')
    return c.value
  }

  async function registerOptions(req: ReqLike, body: Json = {}) {
    if (enabled() && !isUnlocked(req)) throw new AuthError('locked', 'déverrouille d’abord')
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
    if (enabled() && !isUnlocked(req)) throw new AuthError('locked', 'déverrouille d’abord')
    checkBootstrap(body)
    const { origin, rpID } = relying(req)
    const v = await verifyRegistrationResponse({
      response: body.response, expectedChallenge: takeChallenge(req, 'reg'),
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    })
    if (!v.verified || !v.registrationInfo) throw new AuthError('rejected', 'clé refusée')
    const { credential } = v.registrationInfo
    db.credentials.push({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports || [],
      name: String(body.name || 'Appareil').slice(0, 40),
      createdAt: new Date().toISOString(),
    })
    save()
    log(`verrouillage : clé enregistrée (${db.credentials.length})`)
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
    if (!cred) throw new AuthError('unknown_key', 'clé inconnue sur ce Pi')
    const v = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge: takeChallenge(req, 'auth'),
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: cred.id, publicKey: Buffer.from(cred.publicKey, 'base64url'), counter: cred.counter, transports: cred.transports },
    })
    if (!v.verified) throw new AuthError('rejected', 'déverrouillage refusé')
    cred.counter = v.authenticationInfo.newCounter
    cred.lastUsed = new Date().toISOString()
    save()
    return { ok: true, __cookie: sessionCookie(req) }
  }

  function disable(req: ReqLike) {
    if (!isUnlocked(req)) throw new AuthError('locked', 'déverrouille d’abord')
    db.credentials = []
    db.generation += 1
    save()
    log('verrouillage désactivé')
    return { ok: true, __cookie: clearCookie(req) }
  }

  const status = (req: ReqLike): AuthStatus => ({
    enabled: enabled(),
    unlocked: isUnlocked(req),
    ...(enabled() ? { expiresAt: isUnlocked(req) ? Number(readCookie(req)?.split('.')[0]) : null } : {}),
    devices: db.credentials.map(c => ({ name: c.name, createdAt: c.createdAt, lastUsed: c.lastUsed || null })),
  })

  return {
    isUnlocked, status, registerOptions, registerVerify, loginOptions, loginVerify, disable,
    lock: (req: ReqLike) => ({ ok: true, __cookie: clearCookie(req) }),
    // Pour les tests.
    _sessionCookie: sessionCookie,
    _db: () => db,
    _bootstrapToken: () => bootstrapToken,
    _takeChallenge: takeChallenge,
  }
}

export type Auth = ReturnType<typeof createAuth>
