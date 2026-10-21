// A failure the task moved on from, and Finish (herdr-projects `finish`).
import { describe, expect, it } from 'vitest'
import { failureIsStale, finishCase, parseTaskDetails, parseTaskRow, taskActions, taskCanFix, taskStuckFinishing } from '../shared/projectsTasks'
import { finishOffered } from '../app/utils/taskFinish'

const row = (fields: Record<string, unknown>) => parseTaskRow({ id: 'demo/9', title: 'Improve search', app: 'claude', ...fields })!

describe('a failure the task moved on from', () => {
  const at = 1_792_500_000_000
  it('reads when the board recorded it', () => {
    expect(parseTaskDetails(JSON.stringify({ task: { id: 'demo/9' }, failure: { title: 'Review failed', at } })).failureAt).toBe(at)
    expect(parseTaskDetails(JSON.stringify({ task: { id: 'demo/9' }, failure: 'words' })).failureAt).toBeNull()
  })
  it('WHR-38: a review failed, then a run stopped at its limit', () => {
    expect(failureIsStale('stopped', at, { at: at + 3_600_000 })).toBe(true)
  })
  it('WHR-13: the agent started again after a pull request error', () => {
    expect(failureIsStale('asks', at, { at: at - 1000, armedAt: at + 56_000 })).toBe(true)
    expect(failureIsStale('working', at, { startedAgentAt: at + 60_000 })).toBe(true)
  })
  it('the change that records a failure is not taken for a later one', () => {
    // 1.x stamps the failure, then the stage change lands a moment later.
    expect(failureIsStale('approval', at, { at: at + 40 })).toBe(false)
  })
  it('a failed task\'s failure is its own; nothing known: kept', () => {
    expect(failureIsStale('failed', at, { at: at + 3_600_000, armedAt: at + 3_600_000 })).toBe(false)
    expect(failureIsStale('stopped', null, { at: at + 3_600_000 })).toBe(false)
    expect(failureIsStale('stopped', at, null)).toBe(false)
  })
  it('a stale failure is never sent to the agent', () => {
    const d = parseTaskDetails(JSON.stringify({ task: { id: 'demo/9' }, failure: { stage: 'pr', agentCanFix: true, at } }))
    const r = row({ stage: 'asks', state: 'blocked', kind: 'question' })
    expect(taskCanFix(r, d)).toBe(true)
    expect(taskCanFix(r, { ...d, failureStale: true })).toBe(false)
  })
})

describe('Finish, where 1.x finish_anyway takes it', () => {
  it('a limit, no summary, or a row stuck at "Finishing"', () => {
    expect(finishCase(row({ stage: 'stopped', state: 'blocked' }))).toBe('limit')
    expect(finishCase(row({ stage: 'nosummary', state: 'error' }))).toBe('nosummary')
    expect(finishCase(row({ stage: 'working', state: 'working', msg: 'Finishing' }))).toBe('stuck')
    for (const r of [row({ stage: 'working', state: 'working', msg: 'Running tests' }), row({ stage: 'stopped', state: 'idle' }), row({ stage: 'failed', state: 'error' }), row({ stage: 'stopped', state: 'blocked', archivedAt: 1 })]) {
      expect(finishCase(r)).toBeNull()
      expect(taskActions(r).finish).toBe(false)
    }
    expect(taskActions(row({ stage: 'stopped', state: 'blocked' }))).toMatchObject({ finish: true, retry: true })
    expect(taskActions(row({ stage: 'working', state: 'working', msg: 'Finishing' }))).toMatchObject({ finish: true, retry: false })
  })
  it('a row stuck at "Finishing" needs an agent task, and an agent at rest', () => {
    expect(taskStuckFinishing(row({ stage: 'working', state: 'working', msg: 'Finishing', app: '' }))).toBe(false)
    const stuck = row({ stage: 'working', state: 'working', msg: 'Finishing' })
    expect(finishOffered(stuck, 'idle')).toBe(true)
    expect(finishOffered(stuck, null)).toBe(true)
    expect(finishOffered(stuck, 'working')).toBe(false)
    expect(finishOffered(stuck, 'blocked')).toBe(false)
    // A limit stop is offered whatever its pane says.
    expect(finishOffered(row({ stage: 'stopped', state: 'blocked' }), 'working')).toBe(true)
  })
})
