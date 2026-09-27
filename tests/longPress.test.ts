import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { longPress } from '../app/utils/longPress'

const at = (clientX: number, clientY = 0, pointerType = 'touch') => ({ pointerType, clientX, clientY })

describe('appui long', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('se déclenche après 450 ms au doigt immobile, et avale le clic qui suit', () => {
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

  it('toucher simple, défilement ou souris : rien', () => {
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
})
