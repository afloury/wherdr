import { describe, expect, it } from 'vitest'
import { swipeAxis, swipeOffset, swipeStep } from '../app/utils/swipe'

describe('balayage', () => {
  it('decides the axis once the finger has moved', () => {
    expect(swipeAxis(4, 3)).toBeNull()
    expect(swipeAxis(-30, 8)).toBe('x')
    expect(swipeAxis(20, 18)).toBe('y') // diagonal: scroll
    expect(swipeAxis(2, -40)).toBe('y')
  })

  it('next, previous or nothing', () => {
    expect(swipeStep(-120, 400, 390)).toBe(1) // doigt vers la gauche : pane suivant
    expect(swipeStep(120, 400, 390)).toBe(-1)
    expect(swipeStep(-50, 600, 390)).toBe(0) // too short and too slow
    expect(swipeStep(-50, 80, 390)).toBe(1) // quick flick
    expect(swipeStep(-80, 900, 1200)).toBe(0) // big screen: a quarter of the width
  })

  it('amortit le geste et freine au bord', () => {
    expect(swipeOffset(-100, true)).toBe(-55)
    expect(swipeOffset(-100, false)).toBe(-18)
  })
})
