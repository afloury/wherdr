import { describe, expect, it, vi } from 'vitest'
import { createTerminalTouch, touchPreviewOffset } from '../app/utils/terminalTouch'

function gesture(horizontal = false) {
  let time = 0, id = 0
  const frames = new Map<number, FrameRequestCallback>()
  const vertical = vi.fn(), sideways = vi.fn()
  const touch = createTerminalTouch({ vertical, horizontal: sideways, canHorizontal: () => horizontal,
    maxMomentum: () => 150, now: () => time,
    frame: fn => { frames.set(++id, fn); return id }, cancelFrame: n => { frames.delete(n) },
  })
  return { touch, vertical, sideways, frames,
    move(x: number, y: number, ms = 16) { time += ms; touch.move(x, y) },
    wait(ms: number) { time += ms },
    step() { time += 16; for (const [n, fn] of [...frames]) { frames.delete(n); fn(time) } },
  }
}

describe('terminal touch gestures', () => {
  it('distinguishes a tap from a small drag that must not click the agent', () => {
    const g = gesture()
    g.touch.start(0, 0); g.move(1, 2); expect(g.touch.end()).toBe(true)
    g.touch.start(0, 0); g.move(0, 7); expect(g.touch.end()).toBe(false)
  })
  it('preserves drag distance including the initial movement threshold', () => {
    const g = gesture()
    g.touch.start(0, 0); g.move(0, 3); g.move(0, 20); g.move(0, 60)
    expect(g.vertical.mock.calls.reduce((n, [dy]) => n + dy, 0)).toBe(60)
    expect(g.sideways).not.toHaveBeenCalled()
  })
  it('locks horizontal intent rather than flipping axes on diagonal samples', () => {
    const g = gesture(true)
    g.touch.start(0, 0); g.move(20, 1); g.move(23, 40)
    expect(g.sideways.mock.calls.map(([dx]) => dx)).toEqual([20, 3])
    expect(g.vertical).not.toHaveBeenCalled()
  })
  it('adds brief bounded inertia and stops immediately on the next touch', () => {
    const g = gesture()
    g.touch.start(0, 0); g.move(0, 80); g.move(0, 140); g.touch.end()
    const direct = g.vertical.mock.calls.length
    for (let i = 0; i < 40; i++) g.step()
    const momentum = g.vertical.mock.calls.slice(direct).reduce((n, [dy]) => n + dy, 0)
    expect(momentum).toBeGreaterThan(0); expect(momentum).toBeLessThanOrEqual(150)
    expect(g.frames.size).toBe(0)
    g.touch.start(0, 0); g.move(0, 80); g.touch.end(); expect(g.frames.size).toBe(1)
    g.touch.start(0, 0); const count = g.vertical.mock.calls.length
    g.step(); expect(g.vertical).toHaveBeenCalledTimes(count)
  })
  it('does not coast after holding the finger still or cancelling a gesture', () => {
    const g = gesture()
    g.touch.start(0, 0); g.move(0, 100); g.wait(120); g.touch.end()
    expect(g.frames.size).toBe(0)
    g.touch.start(0, 0); g.move(0, 100); g.touch.cancel()
    expect(g.touch.end()).toBe(false); expect(g.frames.size).toBe(0)
  })
  it('forgets velocity when the platform emits stationary touch samples', () => {
    const g = gesture()
    g.touch.start(0, 0); g.move(0, 80); g.move(0, 80, 184); g.touch.end()
    expect(g.frames.size).toBe(0)
  })
  it('reverses inertia with the final movement instead of replaying stale velocity', () => {
    const g = gesture()
    g.touch.start(0, 0); g.move(0, 80); g.move(0, 140); g.move(0, 120); g.touch.end()
    const before = g.vertical.mock.calls.length
    g.step()
    expect(g.vertical.mock.calls[before]![0]).toBeLessThan(0)
  })
  it('glides past the old 240ms cap on a fast flick, then settles', () => {
    let time = 0, id = 0
    const frames = new Map<number, FrameRequestCallback>()
    const vertical = vi.fn()
    const touch = createTerminalTouch({ vertical, horizontal: vi.fn(), canHorizontal: () => false,
      maxMomentum: () => 10000, now: () => time,
      frame: fn => { frames.set(++id, fn); return id }, cancelFrame: n => { frames.delete(n) } })
    touch.start(0, 0)
    time += 16; touch.move(0, -40)
    time += 16; touch.move(0, -80)
    time += 16; touch.move(0, -120)
    touch.end()
    const step = () => { time += 16; for (const [n, fn] of [...frames]) { frames.delete(n); fn(time) } }
    const calls = () => vertical.mock.calls.length
    for (let i = 0; i < 15; i++) step() // 240ms: the old cap would be done
    expect(frames.size).toBe(1)
    for (let i = 0; i < 60; i++) step() // ~1.2s total: long over
    expect(frames.size).toBe(0)
    const momentum = vertical.mock.calls.slice(3).reduce((n, [dy]) => n + dy, 0)
    expect(momentum).toBeLessThan(-350) // a real glide, not a nudge
    expect(calls()).toBeGreaterThan(3)
  })
  it('bleeds release velocity while the finger holds instead of a hard cut', () => {
    for (const hold of [0, 60]) {
      let time = 0, id = 0
      const frames = new Map<number, FrameRequestCallback>()
      const vertical = vi.fn()
      const touch = createTerminalTouch({ vertical, horizontal: vi.fn(), canHorizontal: () => false,
        maxMomentum: () => 10000, now: () => time,
        frame: fn => { frames.set(++id, fn); return id }, cancelFrame: n => { frames.delete(n) } })
      touch.start(0, 0)
      time += 16; touch.move(0, -40)
      time += 16; touch.move(0, -80)
      time += 16; touch.move(0, -120)
      time += hold; touch.end()
      for (let i = 0; i < 80; i++) { time += 16; for (const [n, fn] of [...frames]) { frames.delete(n); fn(time) } }
      const momentum = Math.abs(vertical.mock.calls.slice(3).reduce((n, [dy]) => n + dy, 0))
      if (!hold) expect(momentum).toBeGreaterThan(350)
      else expect(momentum).toBeLessThan(250) // bled to roughly a half
    }
  })
  it('follows the finger up to one row and clamps prediction without a rubber spring', () => {
    expect(touchPreviewOffset(4, 16)).toBe(4)
    expect(touchPreviewOffset(-16, 16)).toBe(-16)
    expect(touchPreviewOffset(400, 16)).toBe(16)
    expect(touchPreviewOffset(-400, 16)).toBe(-16)
    expect(touchPreviewOffset(12, 0)).toBe(1)
  })
})
