import { describe, expect, it } from 'vitest'
import { mirrorLines } from '../app/utils/quoteMirror'

describe('mirrorLines', () => {
  it('keeps every character of every line, in order (the mirror wraps like the field)', () => {
    const draft = '> Tea or coffee?\nCoffee.\n\n> And your favorite series?\nLost!\n'
    expect(mirrorLines(draft).map(l => l.prefix + l.text).join('\n')).toBe(draft)
  })
  it('splits a quote line into its hidden prefix and its text', () => {
    expect(mirrorLines('> One?\n>Two\n>\nAnswer').map(l => [l.quote, l.prefix, l.text])).toEqual([
      [true, '> ', 'One?'], [true, '>', 'Two'], [true, '>', ''], [false, '', 'Answer'],
    ])
  })
  it('marks the ends of each run of quote lines', () => {
    const lines = mirrorLines('> a\n> b\nok\n> c')
    expect(lines.map(l => [l.first, l.last])).toEqual([[true, false], [false, true], [false, false], [true, true]])
  })
  it('only treats a ">" at the very start as a quote', () => {
    expect(mirrorLines(' > not a quote\na > b').every(l => !l.quote)).toBe(true)
  })
})
