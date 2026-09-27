// Verrouillage : cookie de session signé, génération, format de data/auth.json.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAuth } from '../server/utils/auth'

const dir = () => mkdtempSync(path.join(tmpdir(), 'hw-auth-'))
const req = (cookie?: string, origin = 'http://localhost:7684') => ({ headers: { cookie, origin } })
const cookieValue = (setCookie: string) => setCookie.split(';')[0]!
// Une clé factice suffit : isUnlocked ne regarde que leur nombre.
const withKey = (a: ReturnType<typeof createAuth>) => {
  a._db().credentials.push({ id: 'k1', publicKey: 'x', counter: 0, transports: [], name: 'iPhone', createdAt: '2026-01-01T00:00:00.000Z' })
}

describe('auth', () => {
  it('crée data/auth.json (secret, génération 0, aucune clé) au premier démarrage', () => {
    const d = dir()
    createAuth({ dataDir: d })
    const db = JSON.parse(readFileSync(path.join(d, 'auth.json'), 'utf8'))
    expect(db.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(db.generation).toBe(0)
    expect(db.credentials).toEqual([])
  })

  it('reste ouvert tant qu’aucune clé n’est enregistrée', () => {
    const a = createAuth({ dataDir: dir() })
    expect(a.isUnlocked(req())).toBe(true)
    expect(a.status(req())).toEqual({ enabled: false, unlocked: true, devices: [] })
  })

  it('exige un cookie signé valide dès qu’une clé existe', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    expect(a.isUnlocked(req())).toBe(false)
    const c = a._sessionCookie(req())
    expect(c).toMatch(/^hw_session=\d+\.0\.[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/)
    expect(a.isUnlocked(req(cookieValue(c)))).toBe(true)
    expect(a.status(req(cookieValue(c)))).toMatchObject({ enabled: true, unlocked: true, devices: [{ name: 'iPhone' }] })
    expect(a.status(req(cookieValue(c))).expiresAt).toBe(Number(cookieValue(c).split('=')[1]?.split('.')[0]))
  })

  it('refuse un cookie modifié ou expiré', () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    const v = cookieValue(a._sessionCookie(req()))
    expect(a.isUnlocked(req(v.slice(0, -2) + 'xx'))).toBe(false)
    const [exp, gen, mac] = v.replace('hw_session=', '').split('.')
    expect(a.isUnlocked(req(`hw_session=${Number(exp) + 1000}.${gen}.${mac}`))).toBe(false)
    const old = cookieValue(a._sessionCookie(req(), Date.now() - 13 * 3600 * 1000))
    expect(a.isUnlocked(req(old))).toBe(false)
  })

  it('désactiver invalide toutes les sessions (génération suivante)', () => {
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

  it('relit un data/auth.json existant (format de la version précédente)', () => {
    const d = dir()
    writeFileSync(path.join(d, 'auth.json'), JSON.stringify({ secret: 'ab'.repeat(32), generation: 3, credentials: [{ id: 'k', publicKey: 'x', counter: 5, transports: ['internal'], name: 'Laptop', createdAt: '2026-09-25T10:00:00.000Z' }] }))
    const a = createAuth({ dataDir: d })
    expect(a.status(req())).toMatchObject({ enabled: true, unlocked: false, devices: [{ name: 'Laptop', lastUsed: null }] })
    const v = cookieValue(a._sessionCookie(req()))
    expect(v).toMatch(/^hw_session=\d+\.3\./)
    expect(a.isUnlocked(req(v))).toBe(true)
  })

  it('refuse d’ajouter une clé sans être déverrouillé', async () => {
    const a = createAuth({ dataDir: dir() })
    withKey(a)
    await expect(a.registerOptions(req())).rejects.toMatchObject({ code: 'locked' })
  })
})
