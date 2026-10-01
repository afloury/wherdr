import { describe, expect, it } from 'vitest'
import { CHAT_MISS_LIMIT, isStale, noMisses, onError, onUnavailable } from '../app/utils/chatMiss'

describe('conversation kept on a missed poll', () => {
  it('nothing shown: "unavailable" applies right away', () => {
    expect(onUnavailable(noMisses(), false).clear).toBe(true)
  })

  it('conversation shown: a single "unavailable" poll does not empty it', () => {
    const r = onUnavailable(noMisses(), true)
    expect(r.clear).toBe(false)
    expect(r.next.misses).toBe(1)
    expect(isStale(r.next)).toBe(false)
  })

  it('empties only after several "unavailable" in a row', () => {
    let s = noMisses()
    for (let i = 1; i < CHAT_MISS_LIMIT; i++) {
      const r = onUnavailable(s, true)
      expect(r.clear).toBe(false)
      s = r.next
    }
    expect(isStale(s)).toBe(true) // "reconnecting" note meanwhile
    const last = onUnavailable(s, true)
    expect(last.clear).toBe(true)
    expect(last.next).toEqual(noMisses())
  })

  it('read errors: the view stays, the note appears if it lasts', () => {
    const one = onError(noMisses())
    expect(isStale(one)).toBe(false)
    expect(isStale(onError(one))).toBe(true)
  })
})
