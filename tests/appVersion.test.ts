// Nouvelle version après un déploiement : détection et garde anti-boucle.
import { describe, expect, it } from 'vitest'
import { CHUNK_RELOAD_GUARD_MS, isChunkLoadError, isNewBuild, mayReloadForChunk } from '../app/utils/appVersion'

function memStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

describe('isNewBuild', () => {
  it('détecte un autre build', () => {
    expect(isNewBuild('aaa', { id: 'bbb', timestamp: 1 })).toBe(true)
  })
  it('ignore le même build et les réponses illisibles', () => {
    expect(isNewBuild('aaa', { id: 'aaa' })).toBe(false)
    expect(isNewBuild('aaa', null)).toBe(false)
    expect(isNewBuild('aaa', '<html>')).toBe(false)
    expect(isNewBuild('aaa', { id: '' })).toBe(false)
    expect(isNewBuild(undefined, { id: 'bbb' })).toBe(false)
  })
})

describe('isChunkLoadError', () => {
  it('reconnaît les messages des navigateurs', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /_nuxt/x.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
  })
  it('ignore les autres erreurs', () => {
    expect(isChunkLoadError(new Error('boom'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('mayReloadForChunk', () => {
  it('recharge une fois puis s’arrête (pas de boucle)', () => {
    const s = memStorage()
    expect(mayReloadForChunk(s, 1000)).toBe(true)
    expect(mayReloadForChunk(s, 2000)).toBe(false)
    expect(mayReloadForChunk(s, 1000 + CHUNK_RELOAD_GUARD_MS - 1)).toBe(false)
  })
  it('autorise de nouveau après le délai', () => {
    const s = memStorage()
    expect(mayReloadForChunk(s, 1000)).toBe(true)
    expect(mayReloadForChunk(s, 1000 + CHUNK_RELOAD_GUARD_MS)).toBe(true)
  })
  it('sans stockage : jamais de rechargement', () => {
    expect(mayReloadForChunk(null, 1000)).toBe(false)
    expect(mayReloadForChunk({ getItem: () => { throw new Error('x') }, setItem: () => {} }, 1000)).toBe(false)
  })
})
