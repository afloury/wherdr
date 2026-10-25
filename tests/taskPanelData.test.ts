import { describe, expect, it } from 'vitest'
import { groupOf, rowFromTaskFile, taskCanFix, taskCanApproveAnyway, parseTaskRow, parseTaskDetails } from '../shared/projectsTasks'

describe('task panel details', () => {
  it('keeps the failure explanation and the board hint separately', () => {
    const d = parseTaskDetails(JSON.stringify({ task: { id: 'demo/9' }, failure: {
      stage: 'setup', title: 'Setup failed', detail: 'npm ci\nMissing lockfile', next: 'Restore the lockfile, then retry.', agentCanFix: false,
    }, limits: { time: { limit: '2h', used: '3m' }, tokens: { limit: '1m', total: 4200 } } }))
    expect(d).toMatchObject({ failureTitle: 'Setup failed', failureDetail: 'npm ci\nMissing lockfile', failureNext: 'Restore the lockfile, then retry.', failureCanFix: false,
      limits: { time: '2h', timeUsed: '3m', tokens: '1m', tokensUsed: 4200 } })
  })
})

describe('one board state vocabulary', () => {
  it.each([
    ['todo', 'idle', '', 'todo'], ['working', 'working', '', 'working'],
    ['asks', 'blocked', 'question', 'needs'], ['failed', 'error', '', 'needs'],
    ['approval', 'blocked', 'permission', 'ready'], ['done', 'done', '', 'done'],
  ])('%s maps consistently in file and CLI data', (stage, state, kind, group) => {
    expect(groupOf({ stage, state, kind, review: null })).toBe(group)
    expect(rowFromTaskFile({ id: 'demo/9', stage }, null)?.group).toBe(group)
  })
  it('a Herdr finished turn does not finish a board task', () => {
    expect(rowFromTaskFile({ id: 'demo/9', stage: 'working' }, 'done')?.group).toBe('working')
  })
  it('only offers override on a failed approval review or checks, never setup or research', () => {
    const row = parseTaskRow({ id: 'demo/9', stage: 'approval', state: 'blocked', kind: 'permission', review: { error: 'Failed review' }, app: 'claude' })!
    expect(taskCanApproveAnyway(row, null)).toBe(true)
    expect(taskCanApproveAnyway({ ...row, research: true }, null)).toBe(false)
    expect(taskCanApproveAnyway({ ...row, stage: 'failed' }, null)).toBe(false)
    const details = parseTaskDetails(JSON.stringify({ task: { id: row.id }, failure: { stage: 'agent', agentCanFix: true } }))
    expect(taskCanFix(row, details)).toBe(true)
    expect(taskCanFix(row, { ...details, failureAuth: true })).toBe(false)
    expect(taskCanFix({ ...row, archived: true }, details)).toBe(false)
  })
})

it('reads the real review subject, location and proof', () => {
  const d = parseTaskDetails(JSON.stringify({ task: { id: 'demo/9' }, review: { meets: true, pass: false, findings: [{ severity: 'major', subject: 'Missing empty state', where: 'app/search.vue:12', proof: 'The list renders no explanation.' }] } }))
  expect(d.findings).toEqual([{ severity: 'major', title: 'Missing empty state', detail: 'app/search.vue:12 — The list renders no explanation.' }])
})

it('keeps a failed merge or sync in Needs you, not Ready to approve', () => {
  for (const blocker of [{ mergeFailed: true }, { syncBlocked: { why: 'Conflict on main' } }, { prFailure: { title: 'Checks failed' } }, { prState: 'failing' }]) {
    expect(rowFromTaskFile({ id: 'demo/9', stage: 'approval', ...blocker }, null)?.group).toBe('needs')
  }
})
