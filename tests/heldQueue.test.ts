// Message sent while an interactive menu hides the input field: held, then
// delivered in order once the input is back; failed (not "sending…" forever)
// when it really can't go.
import { describe, expect, it } from 'vitest'
import { HOLD_TTL_MS, LOST_MS, type QueueEntry, checkQueue, nextHeld, publicEntry, shouldHold } from '../server/utils/queued'

const entry = (id: string, at: number, more: Partial<QueueEntry> = {}): QueueEntry => ({ id, text: `message ${id}`, at, ...more })

describe('shouldHold', () => {
  it('holds when the agent rests with its input hidden by a menu', () => {
    expect(shouldHold('claude', 'idle', false, false)).toBe(true)
    expect(shouldHold('codex', 'done', false, false)).toBe(true)
  })
  it('sends directly when the input is visible', () => {
    expect(shouldHold('claude', 'idle', true, false)).toBe(false)
  })
  it('keeps Claude’s own queue while it works', () => {
    expect(shouldHold('claude', 'working', false, false)).toBe(false)
  })
  it('queues behind an earlier held message, whatever the screen', () => {
    expect(shouldHold('claude', 'idle', true, true)).toBe(true)
    expect(shouldHold('claude', 'working', true, true)).toBe(true)
  })
  it('leaves other agents alone (no known input line)', () => {
    expect(shouldHold('gemini', 'idle', false, false)).toBe(false)
    expect(shouldHold(null, 'idle', false, false)).toBe(false)
  })
})

describe('nextHeld', () => {
  it('delivers the oldest held message first, exactly once', () => {
    const a = entry('a', 1, { held: true })
    const b = entry('b', 2, { held: true })
    const list = [entry('s', 0), a, b]
    expect(nextHeld(list)).toBe(a)
    a.held = false
    expect(nextHeld(list)).toBe(b)
    b.held = false
    expect(nextHeld(list)).toBeNull()
  })
  it('skips a failed one (waits for Retry or Cancel)', () => {
    const list = [entry('a', 1, { held: true, failed: true }), entry('b', 2, { held: true })]
    expect(nextHeld(list)!.id).toBe('b')
  })
})

describe('checkQueue', () => {
  it('fails a held message after the hold timeout', () => {
    const q = entry('a', 0, { held: true })
    expect(checkQueue([q], 'idle', HOLD_TTL_MS - 1)).toBe(false)
    expect(checkQueue([q], 'idle', HOLD_TTL_MS + 1)).toBe(true)
    expect(publicEntry(q).state).toBe('failed')
  })
  it('fails a delivered message never taken while the agent stays ready', () => {
    const q = entry('a', 0)
    checkQueue([q], 'idle', 1000)
    expect(q.failed).toBeFalsy()
    expect(checkQueue([q], 'idle', 1000 + LOST_MS + 1)).toBe(true)
  })
  it('restarts the timer whenever the agent works (Claude’s own queue)', () => {
    const q = entry('a', 0)
    checkQueue([q], 'idle', 1000)
    checkQueue([q], 'working', 30000)
    checkQueue([q], 'idle', 40000)
    expect(checkQueue([q], 'idle', 40000 + LOST_MS - 1)).toBe(false)
    expect(q.failed).toBeFalsy()
  })
  it('exposes the state to the app', () => {
    expect(publicEntry(entry('a', 5, { held: true }))).toEqual({ id: 'a', text: 'message a', at: 5, state: 'held' })
    expect(publicEntry(entry('b', 5))).toEqual({ id: 'b', text: 'message b', at: 5 })
  })
})
