import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useDelayedFlag } from '../app/composables/useDelayedFlag'

describe('a loading state worth showing (skeletons)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const setup = (start: boolean) => {
    const on = ref(start)
    const scope = effectScope()
    const shown = scope.run(() => useDelayedFlag(on, 300, 300))!
    return { on, shown, scope }
  }

  it('shows nothing for a short load', async () => {
    const { on, shown } = setup(true)
    vi.advanceTimersByTime(250)
    on.value = false
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(shown.value).toBe(false)
  })

  it('shows after the delay, then stays the minimum time once shown', async () => {
    const { on, shown } = setup(true)
    vi.advanceTimersByTime(300)
    expect(shown.value).toBe(true)
    vi.advanceTimersByTime(100)
    on.value = false
    await nextTick()
    expect(shown.value).toBe(true)
    vi.advanceTimersByTime(199)
    expect(shown.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(shown.value).toBe(false)
  })

  it('hides at once past the minimum, and stops its timer with its scope', async () => {
    const { on, shown, scope } = setup(true)
    vi.advanceTimersByTime(700)
    on.value = false
    await nextTick()
    expect(shown.value).toBe(false)
    on.value = true
    await nextTick()
    scope.stop()
    vi.advanceTimersByTime(1000)
    expect(shown.value).toBe(false)
  })
})
