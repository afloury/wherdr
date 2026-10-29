import { describe, expect, it } from 'vitest'
import { gestureAxis, gestureCommits, gestureTarget, wheelGesture } from '../app/utils/tabGesture'

describe('home tab gestures', () => {
  it('locks direction only after deliberate horizontal movement', () => {
    expect(gestureAxis(8, 2)).toBeNull()
    expect(gestureAxis(30, 10)).toBe('x')
    expect(gestureAxis(20, 25)).toBe('y')
  })
  it('commits distance or a short fast flick, never jitter or reversed velocity', () => {
    expect(gestureCommits(98, 0, 390)).toBe(true)
    expect(gestureCommits(30, .6, 390)).toBe(true)
    expect(gestureCommits(20, 2, 390)).toBe(false)
    expect(gestureCommits(30, -.6, 390)).toBe(false)
    expect(gestureCommits(80, .1, 390)).toBe(false)
  })
  it('selects neighbors and never wraps, including empty and single bars', () => {
    expect(gestureTarget(1, 3, -100)).toBe(2)
    expect(gestureTarget(1, 3, 100)).toBe(0)
    expect(gestureTarget(0, 3, 100)).toBe(0)
    expect(gestureTarget(2, 3, -100)).toBe(2)
    expect(gestureTarget(0, 1, -100)).toBe(0)
    expect(gestureTarget(-1, 0, -100)).toBe(-1)
  })
  it('tracks reversals, ignores jitter and locks vertical scrolling', () => {
    const wheel = wheelGesture()
    expect(wheel(8, 0, 0).axis).toBeNull()
    expect(wheel(40, 0, 16).offset).toBe(-48)
    expect(wheel(-30, 0, 32).offset).toBe(-18)
    expect(wheel(4, 80, 300).axis).toBe('y')
    expect(wheel(80, 0, 316).axis).toBe('y')
  })
  it('rearms after silence or renewed pressure without pointer movement', () => {
    const wheel = wheelGesture()
    expect(wheel(60, 0, 0).offset).toBe(-60)
    for (const [i, dx] of [20, 4, 3, 2].entries()) expect(wheel(dx, 0, 16 * (i + 1)).fresh).toBe(false)
    expect(wheel(40, 0, 80)).toMatchObject({ fresh: true, offset: -40 })
    expect(wheel(-60, 0, 300)).toMatchObject({ fresh: true, offset: 60 })
    expect(wheel(-4, 0, 316, true).fresh).toBe(false)
    expect(wheel(60, 0, 332, false)).toMatchObject({ fresh: true, offset: -60 })
  })
})
