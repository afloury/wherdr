// What a Working task is doing, from herdr-projects' stage and status message.
import { describe, expect, it } from 'vitest'
import { ciTally, queuedWhat, taskActivity } from '../shared/taskActivity'

const working = (stage: string, msg: string, queue: number | null = null) => taskActivity({ group: 'working', stage, msg, queue })

describe('taskActivity', () => {
  it('an agent at work: running', () => {
    expect(working('working', 'Writing tests')).toEqual({ kind: 'running' })
    expect(working('reviewing', '')).toEqual({ kind: 'running' })
  })
  it('the board waiting for GitHub checks: ci, with its tally', () => {
    const a = working('merging', 'Waiting for GitHub checks · 1 of 2 passed')
    expect(a).toEqual({ kind: 'ci', passed: 1, total: 2 })
    expect(ciTally(a as Extract<typeof a, { kind: 'ci' }>)).toBe('1/2')
    expect(working('checking', 'waiting for github checks')).toEqual({ kind: 'ci', passed: null, total: null })
  })
  it('a tally that cannot be (3 of 2) is dropped, not shown', () => {
    expect(working('merging', 'Waiting for GitHub checks · 3 of 2 passed')).toEqual({ kind: 'ci', passed: null, total: null })
  })
  it('waiting behind another task: queued, with what it waits for', () => {
    const a = working('after', 'queued after DEMO-70')
    expect(a).toEqual({ kind: 'queued', after: 'DEMO-70', place: null })
    expect(queuedWhat(a as Extract<typeof a, { kind: 'queued' }>)).toBe('DEMO-70')
    // From the message alone, a trailing dot left out.
    expect(working('', 'Queued after host-a:DEMO-3.')).toEqual({ kind: 'queued', after: 'host-a:DEMO-3', place: null })
  })
  it('waiting for a free slot: queued, with its place', () => {
    const a = working('queued', 'waiting for a free slot, Q#2')
    expect(a).toEqual({ kind: 'queued', after: null, place: 2 })
    expect(queuedWhat(a as Extract<typeof a, { kind: 'queued' }>)).toBe('Q#2')
    // The row's own place first.
    expect(working('queued', 'Waiting for a free slot', 3)).toEqual({ kind: 'queued', after: null, place: 3 })
    expect(working('queued', '')).toEqual({ kind: 'queued', after: null, place: null })
  })
  it('an unknown message reads as running', () => {
    expect(working('working', 'Checking the docs')).toEqual({ kind: 'running' })
    expect(working('pushing', 'Something new from a later herdr-projects')).toEqual({ kind: 'running' })
    expect(taskActivity({ group: 'working' })).toEqual({ kind: 'running' })
  })
  it('outside Working: nothing', () => {
    expect(taskActivity({ group: 'needs', stage: 'asks', msg: 'Waiting for GitHub checks' })).toBeNull()
    expect(taskActivity({ group: '', stage: 'queued', msg: '' })).toBeNull()
  })
})
