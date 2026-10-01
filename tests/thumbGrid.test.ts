import { describe, expect, it } from 'vitest'
import { stepImage, thumbLayout, THUMB_MAX } from '../app/utils/thumbGrid'

describe('thumbLayout', () => {
  it('shows every image up to the cap', () => {
    expect(thumbLayout(1)).toEqual({ shown: 1, more: 0 })
    expect(thumbLayout(4)).toEqual({ shown: 4, more: 0 })
    expect(thumbLayout(THUMB_MAX)).toEqual({ shown: THUMB_MAX, more: 0 })
  })
  it('turns the last tile into +N beyond the cap', () => {
    expect(thumbLayout(16)).toEqual({ shown: 8, more: 8 })
    expect(thumbLayout(10)).toEqual({ shown: 8, more: 2 })
  })
  it('accounts for every image', () => {
    for (let n = 0; n < 40; n++) {
      const l = thumbLayout(n)
      expect(l.shown + l.more).toBe(n)
      expect(l.more === 0 || l.more >= 2).toBe(true)
    }
  })
  it('handles odd input', () => {
    expect(thumbLayout(0)).toEqual({ shown: 0, more: 0 })
    expect(thumbLayout(-3)).toEqual({ shown: 0, more: 0 })
  })
})

describe('stepImage', () => {
  it('moves and clamps', () => {
    expect(stepImage(0, 1, 16)).toBe(1)
    expect(stepImage(15, 1, 16)).toBe(15)
    expect(stepImage(0, -1, 16)).toBe(0)
    expect(stepImage(3, 0, 0)).toBe(0)
  })
})
