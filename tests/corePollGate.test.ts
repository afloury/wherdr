// herdr-core events: event-triggered polls keep their 50 ms debounce but start
// at least 400 ms apart (server/utils/state.ts, corePollGate).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { corePollGate } from '../server/utils/state'

describe('core event polls', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('debounces the first event by 50 ms', async () => {
    const run = vi.fn(async () => {})
    const g = corePollGate(run)
    g.schedule()
    g.schedule()
    await vi.advanceTimersByTimeAsync(49)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a burst of events polls at most every 400 ms', async () => {
    const starts: number[] = []
    const g = corePollGate(async () => { starts.push(Date.now()) })
    const t0 = Date.now()
    // One event every 10 ms for 2 s.
    for (let i = 0; i < 200; i++) {
      g.schedule()
      await vi.advanceTimersByTimeAsync(10)
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(starts.length).toBeLessThanOrEqual(6)
    expect(starts[0]! - t0).toBe(50)
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(400)
    // The last event is not lost: a poll follows it.
    expect(starts.at(-1)!).toBeGreaterThan(t0 + 1990)
  })

  it('an event after a quiet period still waits only 50 ms', async () => {
    const run = vi.fn(async () => {})
    const g = corePollGate(run)
    g.schedule()
    await vi.advanceTimersByTimeAsync(1000)
    g.schedule()
    await vi.advanceTimersByTimeAsync(50)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('an event during a slow poll asks for one more poll after it', async () => {
    let release!: () => void
    const run = vi.fn(() => new Promise<void>((r) => { release = r }))
    const g = corePollGate(run)
    g.schedule()
    await vi.advanceTimersByTimeAsync(50)
    g.schedule()
    g.schedule()
    await vi.advanceTimersByTimeAsync(2000)
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(50)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('stopped or cancelled: no poll', async () => {
    const run = vi.fn(async () => {})
    let on = false
    const g = corePollGate(run, { active: () => on })
    g.schedule()
    on = true
    g.schedule()
    g.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).not.toHaveBeenCalled()
  })
})
