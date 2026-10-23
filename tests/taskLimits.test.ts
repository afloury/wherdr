// shared/taskLimits.ts: herdr-projects' limit values read back, said to a
// person, and written again for `set limit.*` (crates/flow/src/limits/run.rs
// time_say, store/settings/values.rs tokens_say and ms, upstream).
import { describe, expect, it } from 'vitest'
import { formatDuration, formatLimit, formatTokenCount, isLimitValue, limitShare, limitStopOf, limitTimeValue, limitTokensValue, parseLimitTime, parseTokenCount, raisePresets } from '../shared/taskLimits'

describe('reading limits as herdr-projects writes them', () => {
  it('times: one unit or several, none is no time', () => {
    expect(parseLimitTime('2h')).toBe(7_200_000)
    expect(parseLimitTime('45m')).toBe(2_700_000)
    expect(parseLimitTime('90s')).toBe(90_000)
    expect(parseLimitTime('1h12m')).toBe(4_320_000)
    expect(parseLimitTime('2m38s')).toBe(158_000)
    for (const v of ['none', '', 'h', '2 hours', '2H', null, 7200]) expect(parseLimitTime(v)).toBeNull()
  })
  it('token counts: k, m, b, raw counts, a comma as a decimal point', () => {
    expect(parseTokenCount('2m')).toBe(2_000_000)
    expect(parseTokenCount('1.5m')).toBe(1_500_000)
    expect(parseTokenCount('1,5M')).toBe(1_500_000)
    expect(parseTokenCount('500k')).toBe(500_000)
    expect(parseTokenCount('2b')).toBe(2e9)
    expect(parseTokenCount(41088783)).toBe(41088783)
    for (const v of ['none', '', '2h', -1, NaN, Infinity, null]) expect(parseTokenCount(v)).toBeNull()
  })
})

describe('saying them', () => {
  it('durations: hours, minutes, seconds only under ten minutes', () => {
    expect(formatDuration(7_200_000)).toBe('2 h')
    expect(formatDuration(4_320_000)).toBe('1 h 12')
    expect(formatDuration(3_900_000)).toBe('1 h 05')
    expect(formatDuration(2_700_000)).toBe('45 min')
    expect(formatDuration(158_000)).toBe('2 min 38')
    expect(formatDuration(120_000)).toBe('2 min')
    expect(formatDuration(725_000)).toBe('12 min')
    expect(formatDuration(30_000)).toBe('30 s')
    expect(formatDuration(0)).toBe('0 s')
    expect(formatDuration(-5)).toBe('0 s')
  })
  it('token counts: herdr-projects precision, upper-case M', () => {
    expect(formatTokenCount(3_400_000)).toBe('3.4 M')
    expect(formatTokenCount(30_000_000)).toBe('30 M')
    expect(formatTokenCount(41_088_783)).toBe('41.1 M')
    expect(formatTokenCount(1_250_000)).toBe('1.25 M')
    expect(formatTokenCount(500_000)).toBe('500 k')
    expect(formatTokenCount(4_200)).toBe('4.2 k')
    expect(formatTokenCount(800)).toBe('800')
    expect(formatTokenCount(0)).toBe('0')
  })
  it('a French decimal comma', () => {
    expect(formatTokenCount(3_400_000, 'fr')).toBe('3,4 M')
    expect(formatTokenCount(500_000, 'fr')).toBe('500 k')
  })
  it('a limit as set on the board', () => {
    expect(formatLimit('time', '2h')).toBe('2 h')
    expect(formatLimit('time', '45m')).toBe('45 min')
    expect(formatLimit('tokens', '30m')).toBe('30 M')
    expect(formatLimit('tokens', '500k')).toBe('500 k')
    expect(formatLimit('time', 'none')).toBe('none')
  })
})

describe('writing a raised limit for `set`', () => {
  it('times: one number, one unit', () => {
    expect(limitTimeValue(3 * 3_600_000)).toBe('3h')
    expect(limitTimeValue(5_400_000)).toBe('90m')
    expect(limitTimeValue(90_000)).toBe('90s')
  })
  it('tokens: m, k, or a count', () => {
    expect(limitTokensValue(60_000_000)).toBe('60m')
    expect(limitTokensValue(1_500_000)).toBe('1500k')
    expect(limitTokensValue(1234)).toBe('1234')
  })
  it('accepts only what herdr-projects takes', () => {
    for (const v of ['3h', '90m', '45s', 'none']) expect(isLimitValue('time', v)).toBe(true)
    for (const v of ['1h30m', '0h', '2 h', '3', '-1h', '', 'none; rm', 3]) expect(isLimitValue('time', v)).toBe(false)
    for (const v of ['60m', '1500k', '1.5m', '1234', 'none']) expect(isLimitValue('tokens', v)).toBe(true)
    for (const v of ['0', '0k', '2h', '--task', '1e9', 12]) expect(isLimitValue('tokens', v)).toBe(false)
  })
})

describe('raise presets', () => {
  it('time: +1 h, ×2, none', () => {
    expect(raisePresets('time', '2h', 7_200_000)).toEqual([
      { id: 'plus1h', value: '3h', resumes: true },
      { id: 'double', value: '4h', resumes: true },
      { id: 'none', value: 'none', resumes: true },
    ])
    expect(raisePresets('time', '45m', null).map(p => p.value)).toEqual(['105m', '90m', 'none'])
  })
  it('tokens: ×2, +10 M, none; one not above what was used is marked', () => {
    expect(raisePresets('tokens', '30m', 31_000_000)).toEqual([
      { id: 'double', value: '60m', resumes: true },
      { id: 'plus10m', value: '40m', resumes: true },
      { id: 'none', value: 'none', resumes: true },
    ])
    // One turn can pass the limit far: ×2 of 2m is not above 5m used.
    expect(raisePresets('tokens', '2m', 5_000_000).map(p => [p.id, p.resumes])).toEqual([['double', false], ['plus10m', true], ['none', true]])
  })
  it('an unreadable limit: only none', () => {
    expect(raisePresets('time', '', null)).toEqual([{ id: 'none', value: 'none', resumes: true }])
  })
})

describe('the gauge and the stop', () => {
  it('share of a limit', () => {
    expect(limitShare(3_400_000, 30_000_000)).toBeCloseTo(0.1133, 3)
    expect(limitShare(null, 10)).toBeNull()
    expect(limitShare(5, 0)).toBeNull()
  })
  it('from details.limits.stopped, the value in force now', () => {
    expect(limitStopOf({ time: '2h', tokens: 'none', stopped: { what: 'time', limit: '2h', used: 7_201_000 } }, '')).toEqual({ kind: 'time', limit: '2h', used: 7_201_000 })
    expect(limitStopOf({ time: 'none', tokens: '30m', tokensCounted: 31_000_000, stopped: { what: 'tokens', limit: '30m', used: 30_500_000 } }, '')).toEqual({ kind: 'tokens', limit: '30m', used: 31_000_000 })
  })
  it('from the board’s line when details say nothing of it', () => {
    expect(limitStopOf(null, 'stopped at its 2h limit')).toEqual({ kind: 'time', limit: '2h', used: null })
    expect(limitStopOf({ tokens: '30m', tokensCounted: 30_100_000 }, 'stopped at 30m tokens')).toEqual({ kind: 'tokens', limit: '30m', used: 30_100_000 })
    expect(limitStopOf(null, 'Asks for your OK')).toBeNull()
  })
})
