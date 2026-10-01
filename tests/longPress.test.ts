import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { longPress } from '../app/utils/longPress'

const at = (clientX: number, clientY = 0, pointerType = 'touch') => ({ pointerType, clientX, clientY })

describe('appui long', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('fires after 450 ms with a still finger, and swallows the following click', () => {
    const onPress = vi.fn()
    const lp = longPress({ onPress })
    lp.down(at(10))
    vi.advanceTimersByTime(449)
    expect(onPress).not.toHaveBeenCalled()
    lp.move(at(14, 3))
    vi.advanceTimersByTime(1)
    expect(onPress).toHaveBeenCalledOnce()
    expect(lp.swallowClick()).toBe(true)
    vi.advanceTimersByTime(900)
    expect(lp.swallowClick()).toBe(false)
  })

  it('simple tap, scroll or mouse: nothing', () => {
    const onPress = vi.fn()
    const lp = longPress({ onPress })
    lp.down(at(10))
    vi.advanceTimersByTime(200)
    lp.cancel()
    lp.down(at(10))
    lp.move(at(30))
    lp.down(at(10, 0, 'mouse'))
    vi.advanceTimersByTime(1000)
    expect(onPress).not.toHaveBeenCalled()
    expect(lp.swallowClick()).toBe(false)
  })

  it('swallows the iPhone click after a long drag released on another pane', () => {
    const lp = longPress({ onPress: vi.fn() })
    lp.down(at(10))
    vi.advanceTimersByTime(450)
    lp.move(at(180))
    vi.advanceTimersByTime(1200)
    expect(lp.swallowClick()).toBe(false)
    lp.suppressClick() // pointerup of the drag, before the synthetic click
    expect(lp.swallowClick()).toBe(true)
    vi.advanceTimersByTime(801)
    expect(lp.swallowClick()).toBe(false)
  })
})
