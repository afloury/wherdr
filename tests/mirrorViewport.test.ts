import { describe, expect, it } from 'vitest'
import { mirrorTop } from '../app/utils/mirrorViewport'

describe('position du miroir', () => {
  it('keeps a top margin if the terminal fits in the cell', () => {
    expect(mirrorTop(300, 250, 24, 25)).toBe(6)
  })

  it('frames on the cursor without shrinking the text', () => {
    expect(mirrorTop(120, 250, 0, 25)).toBe(6)
    expect(mirrorTop(120, 250, 20, 25)).toBe(-96)
    expect(mirrorTop(120, 250, 24, 25)).toBe(-136)
  })
})
