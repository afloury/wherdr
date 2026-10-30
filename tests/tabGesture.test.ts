import { describe, expect, it } from 'vitest'
import { gestureAxis, gestureCommits, gestureOffset, gestureTarget, wheelGesture } from '../app/utils/tabGesture'

describe('home tab gestures', () => {
  it('previews the finger position, reversals and boundary resistance within one page', () => {
    expect(gestureOffset(1, 3, -160, 390)).toBe(-160)
    expect(gestureOffset(1, 3, -40, 390)).toBe(-40)
    expect(gestureOffset(1, 3, 0, 390)).toBe(0)
    expect(gestureOffset(0, 3, 160, 390)).toBe(24)
    expect(gestureOffset(2, 3, -160, 390)).toBe(-24)
    expect(gestureOffset(1, 3, -500, 390)).toBe(-390)
  })
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
    expect(wheel(8, 0, 0)).toMatchObject({ axis: null, step: 0 })
    expect(wheel(40, 0, 16)).toMatchObject({ offset: -48, step: 0 })
    expect(wheel(-30, 0, 32).offset).toBe(-18)
    expect(wheel(4, 80, 300)).toMatchObject({ axis: 'y', step: 0 })
    expect(wheel(80, 0, 316)).toMatchObject({ axis: 'y', step: 0 })
  })
  it('commits at the threshold, not after a two-second inertial tail', () => {
    const wheel = wheelGesture(), changes: number[] = []
    const trace = [4, 10, 18, 24, ...Array.from({ length: 120 }, (_, i) => Math.max(.1, 30 * .94 ** i))]
    trace.forEach((dx, i) => { if (wheel(dx, 0, i * 16).step) changes.push(i * 16) })
    expect(changes).toEqual([48]) // Threshold at 48 ms; no timer or tail delay.
  })
  it.each([1, -1])('rearms a new impulse in direction %s during the tail without a quiet gap', sign => {
    const wheel = wheelGesture(), steps: number[] = []
    const trace = [4, 10, 18, 24, 20, 4, 3, 2, 18 * sign, 18 * sign, 20 * sign, 4 * sign, 3 * sign, 2 * sign]
    trace.forEach((dx, i) => { const s = wheel(dx, 0, i * 16).step; if (s) steps.push(s) })
    expect(steps).toEqual([-56, -56 * sign])
    expect(steps.reduce((index, s) => gestureTarget(index, 5, s), 2)).toBe(sign === 1 ? 4 : 2)
  })
  it('waits for deliberate distance when movement is slow', () => {
    const wheel = wheelGesture()
    expect([20, 20, 20, 20, 5].map((dx, i) => wheel(dx, 0, i * 64).step)).toEqual([0, 0, 0, 0, -85])
  })
  it('can cross the threshold on the first momentum packet, then consumes the rest', () => {
    const wheel = wheelGesture()
    expect(wheel(40, 0, 0, false).step).toBe(0)
    expect(wheel(20, 0, 16, true).step).toBe(-60)
    expect(wheel(120, 0, 600, true).step).toBe(0)
  })
  it('a click cancels the current gesture without letting its tail select again', () => {
    const wheel = wheelGesture()
    wheel(20, 0, 0); wheel.cancel()
    expect(wheel(120, 0, 16).step).toBe(0)
    expect(wheel(60, 0, 200).step).toBe(-60)
  })
  it('consumes boundary attempts and identified momentum, including delayed packets', () => {
    const wheel = wheelGesture()
    expect(gestureTarget(0, 3, wheel(-60, 0, 0).step)).toBe(0)
    expect(wheel(120, 0, 16).step).toBe(0)
    expect(wheel(120, 0, 500, true).step).toBe(0)
    expect(wheel(60, 0, 516, false).step).toBe(-60)
    expect(wheel(60, 0, 800).step).toBe(-60)
  })
})
