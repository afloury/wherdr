// Lock: signed session cookie, generation, data/auth.json format.
import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAuth, type Auth } from '../server/utils/auth'

const dir = () => mkdtempSync(path.join(tmpdir(), 'hw-auth-'))
const req = (cookie?: string, origin = 'http://localhost:7684') => ({ headers: { cookie, origin } })
const cookieValue = (setCookie: string) => setCookie.split(';')[0]!
// A fake key is enough: isUnlocked only looks at their count.
const withKey = (a: ReturnType<typeof createAuth>) => {
  a._db().credentials.push({ id: 'k1', publicKey: 'x', counter: 0, transports: [], name: 'iPhone', createdAt: '2026-01-01T00:00:00.000Z' })
}

describe('auth', () => {
  it('creates data/auth.json (secret, generation 0, no key) on first startup', () => {
    const d = dir()
    createAuth({ dataDir: d })
    const db = JSON.parse(readFileSync(path.join(d, 'auth.json'), 'utf8'))
    expect(db.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(db.generation).toBe(0)
    expect(db.credentials).toEqual([])
  })

  it('stays open as long as no key is registered', () => {
    const a = createAuth({ dataDir: dir() })
    expect(a.isUnlocked(req())).toBe(true)
    expect(a.status(req())).toEqual({ enabled: false, unlocked: true, devices: [] })
  })

  it('requires a valid signed cookie as soon as a key exists', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    expect(a.isUnlocked(req())).toBe(false)
    const c = a._sessionCookie(req())
    expect(c).toMatch(/^hw_session=\d+\.0\.\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/)
    expect(a.isUnlocked(req(cookieValue(c)))).toBe(true)
    expect(a.status(req(cookieValue(c)))).toMatchObject({ enabled: true, unlocked: true, devices: [{ name: 'iPhone' }] })
    expect(a.status(req(cookieValue(c))).expiresAt).toBe(Number(cookieValue(c).split('=')[1]?.split('.')[0]))
  })

  it('refuses a modified or expired cookie', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const v = cookieValue(a._sessionCookie(req()))
    expect(a.isUnlocked(req(v.slice(0, -2) + 'xx'))).toBe(false)
    const [exp, gen, since, mac] = v.replace('hw_session=', '').split('.')
    expect(a.isUnlocked(req(`hw_session=${Number(exp) + 1000}.${gen}.${since}.${mac}`))).toBe(false)
    // The unlock time is signed too: moving it later does not buy more time.
    expect(a.isUnlocked(req(`hw_session=${exp}.${gen}.${Number(since) + 1000}.${mac}`))).toBe(false)
    const old = cookieValue(a._sessionCookie(req(), Date.now() - 13 * 3600 * 1000))
    expect(a.isUnlocked(req(old))).toBe(false)
  })

  it('disabling invalidates all sessions (next generation)', () => {
    const d = dir()
    const a = createAuth({ dataDir: d })
    withKey(a)
    const v = cookieValue(a._sessionCookie(req()))
    const r = a.disable(req(v))
    expect(r.__cookie).toMatch(/Max-Age=0/)
    expect(JSON.parse(readFileSync(path.join(d, 'auth.json'), 'utf8')).generation).toBe(1)
    withKey(a)
    expect(a.isUnlocked(req(v))).toBe(false)
  })

  it('verrouiller efface le cookie ; Secure en HTTPS', () => {
    const a = createAuth({ dataDir: dir() })
    expect(a.lock(req()).__cookie).toBe('hw_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
    expect(a.lock(req(undefined, 'https://herdr.example.ts.net:8103')).__cookie).toMatch(/; Secure$/)
  })

  it('re-reads an existing data/auth.json (previous version format)', () => {
    const d = dir()
    writeFileSync(path.join(d, 'auth.json'), JSON.stringify({ secret: 'ab'.repeat(32), generation: 3, credentials: [{ id: 'k', publicKey: 'x', counter: 5, transports: ['internal'], name: 'Laptop', createdAt: '2026-09-25T10:00:00.000Z' }] }))
    const a = createAuth({ dataDir: d })
    expect(a.status(req())).toMatchObject({ enabled: true, unlocked: false, devices: [{ name: 'Laptop', lastUsed: null }] })
    const v = cookieValue(a._sessionCookie(req()))
    expect(v).toMatch(/^hw_session=\d+\.3\./)
    expect(a.isUnlocked(req(v))).toBe(true)
  })

  it('refuses to add a key without being unlocked', async () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    await expect(a.registerOptions(req())).rejects.toMatchObject({ code: 'locked' })
  })

  it('slides an active session: a cookie older than 10 min is renewed for 12 h', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    const fresh = cookieValue(a._sessionCookie(req(), now - 5 * 60 * 1000))
    expect(a.renew(req(fresh), now)).toBeNull()
    // Issued 11 h 59 min ago: still valid, renewed instead of expiring a minute later.
    const old = cookieValue(a._sessionCookie(req(), now - (12 * 60 - 1) * 60 * 1000))
    const r = a.renew(req(old), now)
    expect(r?.expiresAt).toBe(now + 12 * 3600 * 1000)
    expect(a.isUnlocked(req(cookieValue(r!.cookie)))).toBe(true)
    // Expired or missing sessions are never renewed.
    expect(a.renew(req(cookieValue(a._sessionCookie(req(), now - 13 * 3600 * 1000))), now)).toBeNull()
    expect(a.renew(req(), now)).toBeNull()
  })

  it('reports the server clock with the expiry', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const st = a.status(req(cookieValue(a._sessionCookie(req()))))
    expect(Math.abs(st.now! - Date.now())).toBeLessThan(1000)
    expect(a.status(req()).expiresAt).toBeNull()
  })
})

describe('auth: maximum duration since the passkey unlock', () => {
  const H = 3600 * 1000
  const D = 24 * H
  // A session still in use (renewed a minute ago) whose passkey unlock is `ago` old.
  const inUse = (a: Auth, now: number, ago: number) =>
    req(cookieValue(a._sessionCookie(req(), now - 60 * 1000, now - ago)))

  it('keeps a session past the deadline while in use, and ends it at the next opening despite the slide', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    const r = inUse(a, now, 7 * D + 60 * 1000) // default: 7 days
    // Never in the middle of use: requests and plain status checks still pass.
    expect(a.isUnlocked(r)).toBe(true)
    expect(a.status(r, { now })).toMatchObject({ unlocked: true, deadline: now - 60 * 1000, maxSessionDays: 7 })
    // The slide keeps the unlock time: a renewed cookie is still past the deadline.
    const renewed = a.renew(req(cookieValue(a._sessionCookie(req(), now - 11 * H, now - 7 * D - 60 * 1000))), now)!
    const opened = a.status(req(cookieValue(renewed.cookie)), { resume: true, now })
    expect(opened).toMatchObject({ enabled: true, unlocked: false, expiresAt: null })
    expect(opened.__cookie).toMatch(/^hw_session=; .*Max-Age=0/)
    expect(opened).not.toHaveProperty('deadline')
    // Before the deadline, opening the app keeps the session.
    expect(a.status(inUse(a, now, 6 * D), { resume: true, now })).toMatchObject({ unlocked: true, deadline: now + D })
  })

  it('cuts a client that never reopens one idle period after the deadline', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    expect(a.isUnlocked(inUse(a, now, 7 * D + 11 * H))).toBe(true)
    expect(a.isUnlocked(inUse(a, now, 7 * D + 12 * H + 60 * 1000))).toBe(false)
    expect(a.renew(inUse(a, now, 7 * D + 12 * H + 60 * 1000), now)).toBeNull()
  })

  it('applies a changed duration to existing sessions and keeps it in data/auth.json', () => {
    const d = dir()
    const a = createAuth({ dataDir: d })
    withKey(a)
    const now = Date.now()
    const twoDays = inUse(a, now, 2 * D)
    expect(a.status(twoDays, { resume: true, now }).unlocked).toBe(true)
    expect(a.setMaxSession(twoDays, 1)).toEqual({ ok: true, maxSessionDays: 1 })
    expect(a.status(twoDays, { resume: true, now }).unlocked).toBe(false)
    const tenDays = inUse(a, now, 10 * D)
    a.setMaxSession(inUse(a, now, 0), 30)
    expect(a.status(tenDays, { resume: true, now })).toMatchObject({ unlocked: true, maxSessionDays: 30 })
    expect(JSON.parse(readFileSync(path.join(d, 'auth.json'), 'utf8')).maxSessionDays).toBe(30)
    expect(createAuth({ dataDir: d }).status(tenDays, { now }).maxSessionDays).toBe(30)
  })

  it('only lets an unlocked session pick one of the offered durations', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    expect(() => a.setMaxSession(req(), 30)).toThrow(expect.objectContaining({ code: 'locked' }))
    for (const bad of [0, 2, 3650, '7', null]) {
      expect(() => a.setMaxSession(inUse(a, now, 0), bad)).toThrow(expect.objectContaining({ code: 'invalid' }))
    }
    expect(a._db().maxSessionDays).toBeUndefined()
  })

  it('accepts a cookie from before the unlock time was recorded, counting from its issue', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    const exp = now + 11 * H // issued an hour ago, old format exp.gen.mac
    const legacy = { headers: { cookie: `hw_session=${exp}.0.${createHmac('sha256', a._db().secret!).update(`${exp}.0`).digest('base64url')}` } }
    expect(a.isUnlocked(legacy)).toBe(true)
    const renewed = a.renew(legacy, now)!
    expect(cookieValue(renewed.cookie).split('.')[2]).toBe(String(exp - 12 * H))
  })
})

describe('auth: lock all devices', () => {
  it('ends every session, this one included, and keeps the keys', () => {
    const d = dir()
    const a = createAuth({ dataDir: d })
    withKey(a)
    const mine = req(cookieValue(a._sessionCookie(req())))
    const other = req(cookieValue(a._sessionCookie(req())))
    expect(a.lockAll(mine).__cookie).toMatch(/Max-Age=0/)
    expect(a.isUnlocked(mine)).toBe(false)
    expect(a.isUnlocked(other)).toBe(false)
    const saved = JSON.parse(readFileSync(path.join(d, 'auth.json'), 'utf8'))
    expect(saved.generation).toBe(1)
    expect(saved.credentials).toHaveLength(1)
    // A new passkey unlock opens again.
    expect(a.isUnlocked(req(cookieValue(a._sessionCookie(req()))))).toBe(true)
  })

  it('refuses a locked request', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    expect(() => a.lockAll(req())).toThrow(expect.objectContaining({ code: 'locked' }))
    expect(a._db().generation).toBe(0)
  })
})

describe('auth: damaged cookie', () => {
  it('stays locked without throwing', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    expect(a.isUnlocked(req('hw_session=%E0%A4%A'))).toBe(false)
    expect(a.status(req('hw_session=%E0%A4%A')).unlocked).toBe(false)
  })
})
