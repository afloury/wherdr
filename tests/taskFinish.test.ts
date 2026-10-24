// A failure the task moved on from, and Finish (herdr-projects `finish`).
import { describe, expect, it } from 'vitest'
import { detailsFromTaskFile, rowFromTaskFile, taskCanApproveAnyway, taskCanSendReview, failureIsStale, finishCase, parseTaskDetails, parseTaskRow, taskActions, taskCanFix, taskStuckFinishing } from '../shared/projectsTasks'
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


describe('conversation-only tasks (CLI 1.2.16)', () => {
  it('reads the CLI boolean, not a task-file chat exchange', () => {
    expect(row({ chat: true }).chat).toBe(true)
    for (const chat of [undefined, false, 'true', { held: true }]) expect(row({ chat }).chat).toBe(false)
    expect(parseTaskDetails(JSON.stringify({ task: { id: 'demo/9' }, chat: true })).chat).toBe(true)
    const file = { id: 'demo/9', stage: 'asks', chatRun: true, chat: { held: true } }
    expect(rowFromTaskFile(file, null)?.chat).toBe(true)
    expect(detailsFromTaskFile(file)?.chat).toBe(true)
    expect(rowFromTaskFile({ ...file, chatRun: false }, null)?.chat).toBe(false)
    expect(rowFromTaskFile({ ...file, chatRun: false, settings: { 'chat.only': true } }, null)?.chat).toBe(false)
    expect(rowFromTaskFile({ id: 'demo/9', settings: { 'chat.only': true } }, null)?.chat).toBe(true)
  })
  it('offers finish while waiting, without a limit explanation or merge actions', () => {
    const waiting = row({ chat: true, research: true, stage: 'asks', state: 'blocked' })
    expect(finishCase(waiting)).toBe('conversation')
    expect(taskActions(waiting)).toMatchObject({ tell: true, finish: true, approve: false, retry: false })
    expect(finishOffered(waiting, 'blocked')).toBe(true)
    const approval = { ...waiting, stage: 'approval', review: { pass: false, tally: '', by: '' } }
    expect(taskActions(approval).approve).toBe(false)
    expect(taskCanApproveAnyway(approval, null)).toBe(false)
    expect(taskCanSendReview(approval)).toBe(false)
  })
  it('does not finish an active, completed or archived conversation', () => {
    for (const fields of [
      { stage: 'working', state: 'working' }, { stage: 'done', state: 'done' },
      { stage: 'stopped', state: 'blocked' }, { stage: 'asks', state: 'blocked', archivedAt: 1 },
    ]) expect(taskActions(row({ chat: true, ...fields })).finish).toBe(false)
  })
  it('keeps work and research finish behavior', () => {
    for (const research of [false, true]) {
      expect(finishCase(row({ research, stage: 'stopped', state: 'blocked' }))).toBe('limit')
      expect(taskActions(row({ research, stage: 'asks', state: 'blocked' })).finish).toBe(false)
    }
  })
})

describe('work limit consumption from CLI details', () => {
  it('reads the running time and cumulative tokens', () => {
    const d = parseTaskDetails(JSON.stringify({ task: { id: 'demo/9' }, limits: { time: { limit: '2h', used: '1h12m' }, tokens: { limit: '2m', used: 1, total: 1500000 } } }))
    expect(d.limits).toEqual({ time: '2h', timeUsed: '1h12m', tokens: '2m', tokensUsed: 1500000 })
  })
  it('reads stopped time in milliseconds without inventing a token stop duration', () => {
    for (const [used, text] of [[7200000, '2h'], [7260000, '2h1m'], [61000, '1m1s'], [0, '0s']] as const) {
      expect(parseTaskDetails(JSON.stringify({ task: { id: 'demo/9' }, limits: { stopped: { what: 'time', used } } })).limits?.timeUsed).toBe(text)
    }
    expect(parseTaskDetails(JSON.stringify({ task: { id: 'demo/9' }, limits: { stopped: { what: 'tokens', used: 2000000 } } })).limits?.timeUsed).toBe('')
  })
  it('keeps absent limits and missing usage unknown', () => {
    expect(parseTaskDetails('{"task":{"id":"demo/9"}}').limits).toBeUndefined()
    expect(parseTaskDetails('{"task":{"id":"demo/9"},"limits":{"time":{"limit":"none"},"tokens":{"limit":"none"}}}').limits).toEqual({ time: 'none', timeUsed: '', tokens: 'none', tokensUsed: null })
  })
})
