import { describe, expect, it } from 'vitest'
import { formatTokens, tokenCount } from '../app/utils/tokenCount'

describe('token counts', () => {
  it.each(['en', 'fr'] as const)('formats usage and board limits consistently (%s)', lang => {
    for (const [value, expected] of [[41088783, '41M'], [850000, '850k'], ['30m', '30M'], ['30M', '30M'], [0, '0'], [999, '999'], [1000, '1k'], [10000000, '10M'], [999999, '1M'], [null, '—'], ['none', 'none']] as const) {
      expect(formatTokens(value, lang)).toBe(expected)
    }
    expect(formatTokens(1200000, lang)).toBe(lang === 'fr' ? '1,2M' : '1.2M')
    expect(formatTokens(4200, lang)).toBe('4k')
  })
  it('preserves exact counts and handles unknown or invalid values', () => {
    expect(tokenCount(41088783)).toBe(41088783)
    expect(tokenCount('1,2m')).toBe(1200000)
    expect(tokenCount('850k')).toBe(850000)
    for (const value of [null, undefined, '', 'none', '2h', -1, NaN, Infinity]) expect(tokenCount(value)).toBeNull()
  })
})
