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
    // The cookie outlives the longest duration offered (365 days + 12 h): the server decides.
    expect(c).toMatch(/^hw_session=\d+\.0\.\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=31579200$/)
    expect(a.isUnlocked(req(cookieValue(c)))).toBe(true)
    expect(a.status(req(cookieValue(c)))).toMatchObject({ enabled: true, unlocked: true, devices: [{ name: 'iPhone' }] })
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
    // Unlocked 8 days ago (default: 7 days) and never reopened: cut.
    const old = cookieValue(a._sessionCookie(req(), Date.now() - 8 * 24 * 3600 * 1000))
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

  it('never re-issues a current cookie (no slide, no Set-Cookie churn)', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    expect(a.renew(req(cookieValue(a._sessionCookie(req(), now - 5 * 60 * 1000))), now)).toBeNull()
    expect(a.renew(req(cookieValue(a._sessionCookie(req(), now - 3 * 24 * 3600 * 1000))), now)).toBeNull()
    expect(a.renew(req(), now)).toBeNull()
  })

  it('reports the server clock with the expiry', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const st = a.status(req(cookieValue(a._sessionCookie(req()))))
    expect(Math.abs(st.now! - Date.now())).toBeLessThan(1000)
    // expiresAt: deadline (7 days by default) + 12 h for a client that never reopens.
    expect(st.expiresAt! - st.deadline!).toBe(12 * 3600 * 1000)
    expect(a.status(req()).expiresAt).toBeNull()
  })
})

describe('auth: the chosen duration is the only rule', () => {
  const H = 3600 * 1000
  const D = 24 * H
  // The cookie of a passkey unlock `ago` old (it is never re-issued since).
  const unlocked = (a: Auth, now: number, ago: number) =>
    req(cookieValue(a._sessionCookie(req(), now - ago, now - ago)))

  it('does not lock an unused device before the duration, whatever the idle time', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    a.setMaxSession(unlocked(a, now, 0), 30, now - 40 * D)
    // 13 h, 29 days without any request: opening the app keeps the session.
    expect(a.status(unlocked(a, now, 13 * H), { resume: true, now })).toMatchObject({ unlocked: true, deadline: now + 30 * D - 13 * H })
    expect(a.status(unlocked(a, now, 29 * D), { resume: true, now })).toMatchObject({ unlocked: true, maxSessionDays: 30 })
    // 31 days: past the duration, the passkey is asked again.
    const late = a.status(unlocked(a, now, 31 * D), { resume: true, now })
    expect(late).toMatchObject({ enabled: true, unlocked: false, expiresAt: null })
    expect(late).not.toHaveProperty('deadline')
    // 1 day: 13 h without use still opens, 25 h does not.
    a.setMaxSession(unlocked(a, now, 0), 1, now - 40 * D)
    expect(a.status(unlocked(a, now, 13 * H), { resume: true, now }).unlocked).toBe(true)
    expect(a.status(unlocked(a, now, 25 * H), { resume: true, now }).unlocked).toBe(false)
  })

  it('keeps a session past the deadline while in use, and ends it at the next opening', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    const r = unlocked(a, now, 7 * D + 60 * 1000) // default: 7 days
    // Never in the middle of use: plain status checks still pass.
    expect(a.status(r, { now })).toMatchObject({ unlocked: true, deadline: now - 60 * 1000, maxSessionDays: 7 })
    const opened = a.status(r, { resume: true, now })
    expect(opened).toMatchObject({ enabled: true, unlocked: false, expiresAt: null })
    expect(opened.__cookie).toMatch(/^hw_session=; .*Max-Age=0/)
  })

  it('cuts a client that never reopens 12 h after the deadline', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    expect(a.isUnlocked(unlocked(a, now, 7 * D + 11 * H))).toBe(true)
    expect(a.isUnlocked(unlocked(a, now, 7 * D + 12 * H + 60 * 1000))).toBe(false)
    expect(a.renew(unlocked(a, now, 7 * D + 12 * H + 60 * 1000), now)).toBeNull()
  })

  it('applies a changed duration to open sessions and keeps it in data/auth.json', () => {
    const d = dir()
    const a = createAuth({ dataDir: d })
    withKey(a)
    const now = Date.now()
    const twoDays = unlocked(a, now, 2 * D)
    expect(a.status(twoDays, { resume: true, now }).unlocked).toBe(true)
    // 30 → 1 day: the next opening asks again; a session in use is only cut
    // 12 h after the change, not on the spot.
    expect(a.setMaxSession(twoDays, 1, now)).toEqual({ ok: true, maxSessionDays: 1 })
    expect(a.status(twoDays, { now: now + 11 * H }).unlocked).toBe(true)
    expect(a.status(twoDays, { now: now + 13 * H }).unlocked).toBe(false)
    expect(a.status(twoDays, { resume: true, now }).unlocked).toBe(false)
    // 1 → 30 days: a device unlocked 10 days ago and unused since opens again
    // (its cookie outlives every duration offered).
    const tenDays = a._sessionCookie(req(), now - 10 * D, now - 10 * D)
    expect(Number(tenDays.match(/Max-Age=(\d+)/)![1]) * 1000).toBeGreaterThan(355 * D)
    a.setMaxSession(unlocked(a, now, 0), 30, now)
    expect(a.status(req(cookieValue(tenDays)), { resume: true, now })).toMatchObject({ unlocked: true, maxSessionDays: 30, deadline: now + 20 * D })
    const saved = JSON.parse(readFileSync(path.join(d, 'auth.json'), 'utf8'))
    expect(saved).toMatchObject({ maxSessionDays: 30, maxSessionChangedAt: now })
    expect(createAuth({ dataDir: d }).status(req(cookieValue(tenDays)), { now }).maxSessionDays).toBe(30)
  })

  it('only lets an unlocked session pick one of the offered durations', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    expect(() => a.setMaxSession(req(), 30)).toThrow(expect.objectContaining({ code: 'locked' }))
    for (const bad of [0, 2, 3650, '7', null]) {
      expect(() => a.setMaxSession(unlocked(a, now, 0), bad)).toThrow(expect.objectContaining({ code: 'invalid' }))
    }
    expect(a._db().maxSessionDays).toBeUndefined()
  })

  it('moves a 12 h cookie from an earlier version to the new regime without a passkey', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const now = Date.now()
    const sign = (v: string) => createHmac('sha256', a._db().secret!).update(v).digest('base64url')
    // exp.gen.since.mac, renewed an hour ago, passkey unlock 3 days ago.
    const v = `${now + 11 * H}.0.${now - 3 * D}`
    const old = { headers: { cookie: `hw_session=${v}.${sign(v)}` } }
    expect(a.isUnlocked(old)).toBe(true)
    const renewed = a.renew(old, now)!
    expect(cookieValue(renewed.cookie).split('.')[2]).toBe(String(now - 3 * D))
    expect(Number(renewed.cookie.match(/Max-Age=(\d+)/)![1]) * 1000).toBeGreaterThan(360 * D)
    expect(a.renew(req(cookieValue(renewed.cookie)), now)).toBeNull()
    // Older format exp.gen.mac: counted from its last renewal.
    const exp = now + 11 * H
    const legacy = { headers: { cookie: `hw_session=${exp}.0.${sign(`${exp}.0`)}` } }
    expect(a.isUnlocked(legacy)).toBe(true)
    expect(cookieValue(a.renew(legacy, now)!.cookie).split('.')[2]).toBe(String(exp - 12 * H))
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
