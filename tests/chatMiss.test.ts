import { describe, expect, it } from 'vitest'
import { CHAT_MISS_LIMIT, isStale, noMisses, onError, onUnavailable } from '../app/utils/chatMiss'

describe('conversation gardée sur un sondage raté', () => {
  it('rien d’affiché : « indisponible » s’applique tout de suite', () => {
    expect(onUnavailable(noMisses(), false).clear).toBe(true)
  })

  it('conversation affichée : un sondage « indisponible » isolé ne la vide pas', () => {
    const r = onUnavailable(noMisses(), true)
    expect(r.clear).toBe(false)
    expect(r.next.misses).toBe(1)
    expect(isStale(r.next)).toBe(false)
  })

  it('vide seulement après plusieurs « indisponible » de suite', () => {
    let s = noMisses()
    for (let i = 1; i < CHAT_MISS_LIMIT; i++) {
      const r = onUnavailable(s, true)
      expect(r.clear).toBe(false)
      s = r.next
    }
    expect(isStale(s)).toBe(true) // note « reconnexion » en attendant
    const last = onUnavailable(s, true)
    expect(last.clear).toBe(true)
    expect(last.next).toEqual(noMisses())
  })

  it('erreurs de lecture : la vue reste, la note apparaît si ça dure', () => {
    const one = onError(noMisses())
    expect(isStale(one)).toBe(false)
    expect(isStale(onError(one))).toBe(true)
  })
})
