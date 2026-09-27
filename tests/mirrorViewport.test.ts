import { describe, expect, it } from 'vitest'
import { mirrorTop } from '../app/utils/mirrorViewport'

describe('position du miroir', () => {
  it('garde une marge haute si le terminal tient dans la case', () => {
    expect(mirrorTop(300, 250, 24, 25)).toBe(6)
  })

  it('cadre sur le curseur sans réduire le texte', () => {
    expect(mirrorTop(120, 250, 0, 25)).toBe(6)
    expect(mirrorTop(120, 250, 20, 25)).toBe(-96)
    expect(mirrorTop(120, 250, 24, 25)).toBe(-136)
  })
})
