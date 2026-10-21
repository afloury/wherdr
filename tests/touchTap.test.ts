import { describe, expect, it, vi } from 'vitest'
import { TAP_SLOP, createTouchTap, liftsOn } from '../app/utils/touchTap'

const box = { left: 100, top: 200, right: 132, bottom: 232 }
const button = { getBoundingClientRect: () => box }

function touchEvent(points: { id: number, x: number, y: number }[], active: number) {
  const list = points.map(p => ({ identifier: p.id, clientX: p.x, clientY: p.y }))
  return {
    touches: Array.from({ length: active }, (_, i) => list[i] || list[0]!),
    changedTouches: list,
    currentTarget: button as unknown as EventTarget,
    preventDefault: vi.fn(),
  }
}

describe('liftsOn', () => {
  it('counts the button and a margin around it', () => {
    expect(liftsOn(box, 116, 216)).toBe(true)
    expect(liftsOn(box, box.right + TAP_SLOP, box.bottom + TAP_SLOP)).toBe(true)
    expect(liftsOn(box, box.left - TAP_SLOP - 1, 216)).toBe(false)
    expect(liftsOn(box, 116, box.top - 30, 20)).toBe(false)
  })
})

describe('createTouchTap', () => {
  function setup(enabled = true) {
    const run = vi.fn()
    const press = vi.fn()
    let on = enabled
    const tap = createTouchTap({ enabled: () => on, run, press })
    return { tap, run, press, enable: (v: boolean) => { on = v } }
  }

  it('runs once on a tap that drifts a little, and cancels the browser defaults', () => {
    const { tap, run, press } = setup()
    const start = touchEvent([{ id: 3, x: 116, y: 216 }], 1)
    tap.start(start)
    expect(start.preventDefault).toHaveBeenCalled()
    expect(press).toHaveBeenLastCalledWith(true)
    const end = touchEvent([{ id: 3, x: 119, y: 213 }], 0)
    tap.end(end)
    expect(end.preventDefault).toHaveBeenCalled()
    expect(run).toHaveBeenCalledTimes(1)
    expect(press).toHaveBeenLastCalledWith(false)
    // A stray second touchend does nothing.
    tap.end(end)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not run when the finger slides away', () => {
    const { tap, run, press } = setup()
    tap.start(touchEvent([{ id: 1, x: 116, y: 216 }], 1))
    tap.end(touchEvent([{ id: 1, x: 116, y: 300 }], 0))
    expect(run).not.toHaveBeenCalled()
    expect(press).toHaveBeenLastCalledWith(false)
  })

  it('leaves a disabled button to the browser', () => {
    const { tap, run } = setup(false)
    const start = touchEvent([{ id: 1, x: 116, y: 216 }], 1)
    tap.start(start)
    expect(start.preventDefault).not.toHaveBeenCalled()
    const end = touchEvent([{ id: 1, x: 116, y: 216 }], 0)
    tap.end(end)
    expect(end.preventDefault).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('does not run if the button got disabled while pressed', () => {
    const { tap, run, enable } = setup()
    tap.start(touchEvent([{ id: 1, x: 116, y: 216 }], 1))
    enable(false)
    tap.end(touchEvent([{ id: 1, x: 116, y: 216 }], 0))
    expect(run).not.toHaveBeenCalled()
  })

  it('ignores a second finger and a cancelled touch', () => {
    const { tap, run } = setup()
    const pinch = touchEvent([{ id: 1, x: 116, y: 216 }, { id: 2, x: 120, y: 220 }], 2)
    tap.start(pinch)
    expect(pinch.preventDefault).not.toHaveBeenCalled()
    tap.end(touchEvent([{ id: 1, x: 116, y: 216 }], 0))
    expect(run).not.toHaveBeenCalled()

    tap.start(touchEvent([{ id: 4, x: 116, y: 216 }], 1))
    tap.cancel()
    tap.end(touchEvent([{ id: 4, x: 116, y: 216 }], 0))
    expect(run).not.toHaveBeenCalled()
  })

  it('only answers the touch it started with', () => {
    const { tap, run } = setup()
    tap.start(touchEvent([{ id: 5, x: 116, y: 216 }], 1))
    tap.end(touchEvent([{ id: 6, x: 116, y: 216 }], 0))
    expect(run).not.toHaveBeenCalled()
    tap.end(touchEvent([{ id: 5, x: 116, y: 216 }], 0))
    expect(run).toHaveBeenCalledTimes(1)
  })
})
