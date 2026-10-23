import { describe, expect, it } from 'vitest'
import { formatTokens, tokenCount } from '../app/utils/tokenCount'

describe('token counts', () => {
  it.each(['en', 'fr'] as const)('formats usage and board limits consistently (%s)', lang => {
    for (const [value, expected] of [[41088783, lang === 'fr' ? '41,1 M' : '41.1 M'], [850000, '850 k'], ['30m', '30 M'], ['30M', '30 M'], [0, '0'], [999, '999'], [1000, '1 k'], [10000000, '10 M'], [999999, '1000 k'], [null, '—'], ['none', 'none']] as const) {
      expect(formatTokens(value, lang)).toBe(expected)
    }
    expect(formatTokens(1200000, lang)).toBe(lang === 'fr' ? '1,2 M' : '1.2 M')
    expect(formatTokens(4200, lang)).toBe(lang === 'fr' ? '4,2 k' : '4.2 k')
  })
  it('preserves exact counts and handles unknown or invalid values', () => {
    expect(tokenCount(41088783)).toBe(41088783)
    expect(tokenCount('1,2m')).toBe(1200000)
    expect(tokenCount('850k')).toBe(850000)
    for (const value of [null, undefined, '', 'none', '2h', -1, NaN, Infinity]) expect(tokenCount(value)).toBeNull()
  })
})
