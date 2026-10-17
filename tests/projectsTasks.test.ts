// herdr-projects 1.x output, parsed as wherdr reads it. The fixtures are the
// real output of the 1.2.1 release binary, run in an isolated HOME with Herdr
// unreachable (tests/recordings/herdr-projects-1.2.1/).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cleanTell, cleanUrl, groupOf, isTaskId, parseReview, parseTaskDetails, parseTaskList, prNumber, sortTasks, taskActions,
} from '../shared/projectsTasks'

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'recordings/herdr-projects-1.2.1', name), 'utf8')

describe('list --json (1.2.1)', () => {
  const rows = parseTaskList(fixture('list.json'))

  it('reads every task with its id, repo and number', () => {
    expect(rows.map(r => r.id)).toEqual(['demo/4', 'demo/3', 'demo/2', 'demo/1'])
    expect(rows[0]).toMatchObject({ repo: 'demo', n: 4, title: 'Old cleanup', state: 'done', msg: 'Merged' })
  })

  it('sorts tasks into the board\'s five groups', () => {
    expect(Object.fromEntries(rows.map(r => [r.id, r.group]))).toEqual({
      'demo/4': 'done', 'demo/3': 'working', 'demo/2': 'needs', 'demo/1': 'ready',
    })
  })

  it('keeps the pull request, the review and the agent', () => {
    const r = rows.find(x => x.id === 'demo/1')!
    expect(r).toMatchObject({ app: 'claude', pr: 'https://github.com/example/demo/pull/7', reviewRound: 1, kind: 'permission', stage: 'approval' })
    expect(r.review).toEqual({ pass: true, tally: '1 minor', by: 'codex' })
  })

  it('refuses output that is not a list, and drops rows it cannot read', () => {
    expect(() => parseTaskList('No tasks.')).toThrow(/not JSON/)
    expect(() => parseTaskList('{"id":"a/1"}')).toThrow(/not a list/)
    expect(parseTaskList('[{"id":"../1"},{"id":"a/x"},null,{"id":"a/2","state":"idle","stage":"todo","title":"T"}]').map(r => r.id)).toEqual(['a/2'])
  })

  it('ignores fields it does not know, and bounds the ones it keeps', () => {
    const [r] = parseTaskList(JSON.stringify([{ id: 'a/1', state: 'working', title: 'x'.repeat(1000), progress: 140, extra: { deep: true }, pr: 'javascript:alert(1)' }]))
    expect(r!.title).toHaveLength(300)
    expect(r!.progress).toBe(100)
    expect(r!.pr).toBe('')
    expect(r).not.toHaveProperty('extra')
  })
})

describe('details --json (1.2.1)', () => {
  it('finished work waiting for approval', () => {
    const d = parseTaskDetails(fixture('details-approval.json'))
    expect(d).toMatchObject({
      id: 'demo/1', title: 'Fix login redirect', stage: 'approval', description: 'The login page loops',
      agent: 'claude', pr: 'https://github.com/example/demo/pull/7', branch: 'demo-1-fix-login', reviewRounds: 1, failure: '', plan: '',
    })
    expect(d.review?.pass).toBe(true)
  })

  it('a task that asks a question, and one at work', () => {
    expect(parseTaskDetails(fixture('details-asks.json'))).toMatchObject({ id: 'demo/2', stage: 'asks', msg: 'Which changelog format?', pr: '', review: null })
    expect(parseTaskDetails(fixture('details-working.json'))).toMatchObject({ id: 'demo/3', stage: 'working', agent: 'codex', branch: 'demo-3-dark-mode' })
  })

  it('refuses a reply without a task', () => {
    expect(() => parseTaskDetails('{}')).toThrow(/unexpected/)
    expect(() => parseTaskDetails('oops')).toThrow(/not JSON/)
  })

  it('reads a failure given as words or as an object', () => {
    const base = JSON.parse(fixture('details-asks.json'))
    expect(parseTaskDetails(JSON.stringify({ ...base, failure: 'tests failed' })).failure).toBe('tests failed')
    expect(parseTaskDetails(JSON.stringify({ ...base, failure: { msg: 'merge conflict' } })).failure).toBe('merge conflict')
  })
})

describe('groups and actions', () => {
  const row = (o: Partial<Parameters<typeof groupOf>[0]>) => ({ state: 'idle', kind: '', stage: 'todo', review: null, ...o })

  it('finished work whose review failed needs you, not your approval', () => {
    expect(groupOf(row({ state: 'blocked', kind: 'permission', stage: 'approval', review: { pass: true, tally: '', by: '' } }))).toBe('ready')
    expect(groupOf(row({ state: 'blocked', kind: 'permission', stage: 'approval', review: { pass: false, tally: '1 major', by: '' } }))).toBe('needs')
    expect(groupOf(row({ state: 'error', stage: 'failed' }))).toBe('needs')
    expect(groupOf(row({ state: 'working', stage: 'reviewing' }))).toBe('working')
    expect(groupOf(row({}))).toBe('todo')
  })

  it('offers reply on a live task and approve where the board waits for a yes', () => {
    const live = { state: 'blocked', stage: 'asks', group: 'needs', archived: false, app: 'claude' } as const
    expect(taskActions(live)).toEqual({ tell: true, approve: false })
    expect(taskActions({ ...live, stage: 'approval', group: 'ready' })).toEqual({ tell: true, approve: true })
    expect(taskActions({ ...live, stage: 'plan' })).toEqual({ tell: true, approve: true })
    expect(taskActions({ state: 'idle', stage: 'todo', group: 'todo', archived: false, app: '' })).toEqual({ tell: false, approve: false })
    // No agent has been on it yet: 1.x refuses a message.
    expect(taskActions({ ...live, app: '' })).toEqual({ tell: false, approve: false })
    expect(taskActions({ ...live, archived: true })).toEqual({ tell: false, approve: false })
  })

  it('orders by group, then repo, newest first', () => {
    const rows = parseTaskList(JSON.stringify([
      { id: 'b/1', state: 'idle', stage: 'todo' }, { id: 'a/2', state: 'idle', stage: 'todo' },
      { id: 'a/9', state: 'working', stage: 'working' }, { id: 'a/3', state: 'idle', stage: 'todo' },
    ]))
    expect(sortTasks(rows).map(r => r.id)).toEqual(['a/9', 'a/3', 'a/2', 'b/1'])
  })
})

describe('small checks', () => {
  it('task ids', () => {
    expect(isTaskId('herdr-superwork/218')).toBe(true)
    expect(isTaskId('HSW-218')).toBe(false)
    expect(isTaskId('a/b/1')).toBe(false)
  })

  it('links and pull request numbers', () => {
    expect(cleanUrl('https://github.com/o/r/pull/12')).toBe('https://github.com/o/r/pull/12')
    expect(cleanUrl('http://x')).toBe('')
    expect(prNumber('https://github.com/o/r/pull/12')).toBe('#12')
    expect(prNumber('https://gitlab.example/o/r/-/merge_requests/3')).toBe('')
  })

  it('a review from before the gate, and a review error', () => {
    expect(parseReview({ score: 3, recommend: false, by: 'codex' })).toEqual({ pass: false, tally: '3/5', by: 'codex' })
    expect(parseReview({ error: 'reviewer crashed' })).toEqual({ pass: false, tally: 'reviewer crashed', by: '' })
    expect(parseReview({ stale: true, findings: [], meets: true })).toBeNull()
    expect(parseReview({ meets: false, pass: false, findings: [{ severity: 'critical' }, { severity: 'odd' }, { severity: 'minor', preexisting: true }] }))
      .toEqual({ pass: false, tally: '1 critical, 1 major, 1 pre-existing', by: '' })
  })

  it('text sent to an agent', () => {
    expect(cleanTell('  hello\r\nworld  ')).toBe('hello\nworld')
    expect(cleanTell(42)).toBe('')
    expect(cleanTell('x'.repeat(9000))).toHaveLength(8000)
  })
})
