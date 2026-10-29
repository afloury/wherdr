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
  it('ignores small wheels and consumes the entire inertial tail', () => {
    const wheel = wheelGesture()
    expect(wheel(10, 0, 0)).toBe(0)
    expect(wheel(48, 0, 20)).toBe(-1)
    for (let at = 40; at < 1000; at += 20) expect(wheel(80, 0, at)).toBe(0)
    expect(wheel(-60, 0, 1300)).toBe(1)
    expect(wheel(4, 80, 1600)).toBe(0)
  })
})
