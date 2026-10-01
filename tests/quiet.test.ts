import { describe, expect, it } from 'vitest'
import { nextMorning, parseQuiet, quietActive, quietUntil, silenced } from '../shared/quiet'

const now = new Date(2026, 0, 15, 14, 30).getTime()

describe('mode silence', () => {
  it('active until the end, then automatic return', () => {
    expect(quietActive(null, now)).toBe(false)
    expect(quietActive({ until: null }, now)).toBe(true)
    expect(quietActive({ until: now + 1000 }, now)).toBe(true)
    expect(quietActive({ until: now }, now)).toBe(false)
    expect(quietActive({ until: now - 1 }, now)).toBe(false)
  })

  it('mutes one device by its subscription or all by the global setting', () => {
    expect(silenced(null, null, now)).toBe(false)
    expect(silenced(null, { until: null }, now)).toBe(true)
    expect(silenced({ until: now + 60000 }, null, now)).toBe(true)
    expect(silenced({ until: now - 1 }, { until: now - 1 }, now)).toBe(false)
    expect(silenced({ until: now - 1 }, { until: now + 1 }, now)).toBe(true)
  })

  it('calcule 1 h et le prochain 8 h', () => {
    expect(quietUntil('hour', new Date(now))).toBe(now + 3600000)
    expect(quietUntil('manual', new Date(now))).toBeNull()
    expect(nextMorning(new Date(now))).toBe(new Date(2026, 0, 16, 8).getTime())
    expect(nextMorning(new Date(2026, 0, 15, 2))).toBe(new Date(2026, 0, 15, 8).getTime())
    expect(nextMorning(new Date(2026, 0, 15, 8))).toBe(new Date(2026, 0, 16, 8).getTime())
  })

  it('validates the request body', () => {
    expect(parseQuiet(false, 123, now)).toBeNull()
    expect(parseQuiet(true, null, now)).toEqual({ until: null })
    expect(parseQuiet(true, now + 1000, now)).toEqual({ until: now + 1000 })
    expect(parseQuiet(true, now - 1, now)).toBeUndefined()
    expect(parseQuiet(true, now + 30 * 86400000, now)).toBeUndefined()
    expect(parseQuiet('yes', null, now)).toBeUndefined()
  })
})
