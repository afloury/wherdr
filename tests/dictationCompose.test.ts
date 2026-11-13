import { describe, expect, it } from 'vitest'
import { insertDictated, parseDictationChoice, takeClock, waveText } from '../app/utils/dictation/compose'

describe('insertDictated', () => {
  it('appends at the end with one space', () => {
    expect(insertDictated('', 'hello')).toEqual({ text: 'hello', caret: 5 })
    expect(insertDictated('Fix', 'the cache')).toEqual({ text: 'Fix the cache', caret: 13 })
    expect(insertDictated('Fix ', 'it')).toEqual({ text: 'Fix it', caret: 6 })
    expect(insertDictated('line\n', 'next')).toEqual({ text: 'line\nnext', caret: 9 })
  })

  it('goes at the caret, spaced from both sides', () => {
    expect(insertDictated('Fix cache', 'the', { start: 3, end: 3 })).toEqual({ text: 'Fix the cache', caret: 7 })
    expect(insertDictated('Fix the cache', 'that', { start: 4, end: 7 })).toEqual({ text: 'Fix that cache', caret: 8 })
    expect(insertDictated('cache', 'Fix', { start: 0, end: 0 })).toEqual({ text: 'Fix cache', caret: 3 })
  })
})

describe('waveText', () => {
  it('pads silence on the left and rises with the level', () => {
    expect(waveText([], 4)).toBe('▁▁▁▁')
    expect(waveText([0, 0.01, 0.05, 1], 4)).toBe('▁▂▄█')
    expect(waveText([1, 1, 1, 1, 0], 3)).toBe('██▁')
  })
})

describe('takeClock', () => {
  it('reads minutes and seconds', () => {
    expect(takeClock(0)).toBe('0:00')
    expect(takeClock(7_900)).toBe('0:07')
    expect(takeClock(112_000)).toBe('1:52')
  })
})

describe('parseDictationChoice', () => {
  it('keeps a present engine, else off', () => {
    expect(parseDictationChoice('cloud', ['cloud'])).toBe('cloud')
    expect(parseDictationChoice('device', ['cloud'])).toBe('off')
    expect(parseDictationChoice(null, ['cloud'])).toBe('off')
  })
})
