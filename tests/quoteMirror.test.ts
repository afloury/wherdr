import { describe, expect, it } from 'vitest'
import { mirrorLines } from '../app/utils/quoteMirror'

describe('mirrorLines', () => {
  it('keeps every character of every line, in order (the mirror wraps like the field)', () => {
    const draft = '↳ Quote point 11:37 : Tea or coffee? —\nCoffee.\n\n↳ Quote message 11:35 : And your favorite series? —  \nLost!\n> typed\n'
    expect(mirrorLines(draft).map(l => l.head + l.text + l.tail).join('\n')).toBe(draft)
  })
  it('splits a reference line into what introduces it, its excerpt and its closing dash', () => {
    expect(mirrorLines('↳ Quote decision 11:37 #3 : Publish — today? —\nYes\n↳ Décision : Publier ? —').map(l => [l.ref, l.head, l.text, l.tail])).toEqual([
      [true, '↳ Quote decision 11:37 #3 : ', 'Publish — today?', ' —'],
      [false, '', 'Yes', ''],
      [true, '↳ Décision : ', 'Publier ?', ' —'],
    ])
  })
  it('draws nothing else as a token: ">" lines, lookalikes, a reference off the first column', () => {
    expect(mirrorLines('> a quote typed by hand\n>>>\n↳ note —\n ↳ Quote point 11:37 : pasted —\n↳ Quote point 11:37 : answered — yes').every(l => !l.ref)).toBe(true)
  })
})
