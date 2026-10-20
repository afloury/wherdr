// herdr-projects 1.x output, parsed as wherdr reads it. The fixtures are the
// real output of the 1.2.1 release binary, run in an isolated HOME with Herdr
// unreachable (tests/recordings/herdr-projects-1.2.1/).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NOTIFY_SETUP, NO_ACTIONS, addArgs, agentKind, delegateArgs, isAgentName, parseWorkerAgent, restoreAgentArgs, runOver, cleanRepo, cleanTarget, cleanTell, cleanTitle, cleanUrl, coordinatorArgs, coordinatorPhase, coordinatorRestartArgs, coordinatorStatusArgs, coordinatorSubject, detailsFromTaskFile, parseCoordinatorStatus, groupByRepo, groupCounts, groupOf,
  rowFromTaskFile, stateFromTaskFile, isTaskId, parseReview, parseRepoKey, parseTaskDetails, parseTaskList, prNumber, repoKeysFromFile, sortTasks, taskActions, taskKey, taskNotice,
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
    const live = { state: 'blocked', kind: 'question', stage: 'asks', group: 'needs', archived: false, app: 'claude' } as const
    expect(taskActions(live)).toEqual({ ...NO_ACTIONS, tell: true, stop: true, archive: true })
    expect(taskActions({ ...live, kind: 'permission', stage: 'approval', group: 'ready' })).toMatchObject({ tell: true, approve: true })
    expect(taskActions({ ...live, kind: 'permission', stage: 'plan' })).toMatchObject({ tell: true, approve: true })
    // No agent has been on it yet: 1.x refuses a message, and there is none to stop.
    expect(taskActions({ ...live, app: '' })).toEqual({ ...NO_ACTIONS, archive: true })
    // Archived: read-only, as 1.x has it; Restore is all it offers.
    expect(taskActions({ ...live, archived: true })).toEqual({ ...NO_ACTIONS, restore: true })
    expect(taskActions({ ...live, archived: true, stage: 'failed', state: 'error' }, { failureStage: 'agent', failureAuth: false })).toEqual({ ...NO_ACTIONS, restore: true })
    expect(taskActions(live).restore).toBe(false)
  })

  it('start on the backlog, stop on an agent at work, retry what went wrong, archive all but work under way', () => {
    const todo = { state: 'idle', kind: '', stage: 'todo', group: 'todo', archived: false, app: '' } as const
    expect(taskActions(todo)).toEqual({ ...NO_ACTIONS, delegate: true, archive: true })
    // A task its agent stopped is back under To do: it can start again.
    expect(taskActions({ ...todo, stage: 'stopped', app: 'codex' })).toMatchObject({ delegate: true, stop: false })
    const working = { ...todo, state: 'working', stage: 'working', group: 'working', app: 'codex' } as const
    expect(taskActions(working)).toEqual({ ...NO_ACTIONS, tell: true, stop: true })
    expect(taskActions({ ...working, stage: 'queued' })).toMatchObject({ stop: true, archive: false })
    const failed = { ...todo, state: 'error', stage: 'failed', group: 'needs', app: 'claude' } as const
    // What failed is not known yet (no details): neither Retry nor Start.
    expect(taskActions(failed)).toMatchObject({ retry: false, stop: false, archive: true, delegate: false })
    expect(taskActions(failed, { failureStage: 'agent', failureAuth: false })).toMatchObject({ retry: true, delegate: false })
    // Stopped at a limit: retry continues it; nothing runs to stop.
    expect(taskActions({ ...failed, state: 'blocked', stage: 'stopped' })).toMatchObject({ retry: true, stop: false })
    // Waiting for a sign-in: not an agent at work.
    expect(taskActions({ ...failed, state: 'blocked', kind: 'auth' })).toMatchObject({ stop: false })
    expect(taskActions({ ...todo, state: 'done', stage: 'done', group: 'done' })).toEqual({ ...NO_ACTIONS, archive: true })
  })

  // 1.2.1: `retry` is finish_line::send_error (cli/tasks.rs), `archive`
  // refuses SLOT_STAGES, queued and attempts (actions/archive.rs).
  it('offers Retry only where 1.2.1 send_error takes it', () => {
    const failed = { state: 'error', kind: '', stage: 'failed', group: 'needs', archived: false, app: 'claude' } as const
    const f = (failureStage: string, failureAuth = false) => ({ failureStage, failureAuth })
    // A failure of the agent or of the finish line goes back to the agent.
    for (const st of ['agent', 'workflow', 'pr', 'merge']) expect(taskActions(failed, f(st)).retry).toBe(true)
    // The agent never took its text: started again (retry()).
    expect(taskActions(failed, f('send')).retry).toBe(true)
    // Failed before an agent got going (no link.pane): send_error refuses; Start again instead.
    for (const st of ['start', 'setup', 'attempts']) expect(taskActions(failed, f(st))).toMatchObject({ retry: false, delegate: true })
    // A login problem needs the human first (the reply goes to the agent).
    expect(taskActions({ ...failed, state: 'blocked', kind: 'auth' }, f('agent', true))).toMatchObject({ retry: false, delegate: false })
    // Stopped without a summary: the agent is told to continue.
    expect(taskActions({ ...failed, stage: 'nosummary' }).retry).toBe(true)
    // The agent's terminal is gone or it exited: still at work for 1.x ("has no agent error to send").
    const gone = { ...failed, stage: 'working' }
    expect(taskActions(gone)).toMatchObject({ retry: false, archive: false, stop: true })
  })

  it('hides Archive in every stage 1.2.1 refuses, whatever the column', () => {
    // An agent at work that asks you something: column "needs you", stage still working.
    const asking = { state: 'blocked', kind: '', stage: 'working', group: 'needs', archived: false, app: 'claude' } as const
    expect(taskActions(asking)).toMatchObject({ archive: false, stop: true, tell: true })
    for (const stage of ['starting', 'setup', 'checking', 'pushing', 'reviewing', 'merging', 'queued', 'attempts']) {
      expect(taskActions({ ...asking, stage }).archive).toBe(false)
    }
    // Waiting for you without anything running: archive is fine.
    for (const stage of ['asks', 'approval', 'plan', 'failed', 'nosummary', 'stopped', 'reviewneeds']) {
      expect(taskActions({ ...asking, stage }).archive).toBe(true)
    }
  })

  it('orders by group, then repo, newest first', () => {
    const rows = parseTaskList(JSON.stringify([
      { id: 'b/1', state: 'idle', stage: 'todo' }, { id: 'a/2', state: 'idle', stage: 'todo' },
      { id: 'a/9', state: 'working', stage: 'working' }, { id: 'a/3', state: 'idle', stage: 'todo' },
    ]))
    expect(sortTasks(rows).map(r => r.id)).toEqual(['a/9', 'a/3', 'a/2', 'b/1'])
  })

  it('keeps done newest first, in the order of the list, whatever the repo', () => {
    // herdr-projects lists its tasks newest first (by when they were created).
    const rows = parseTaskList(JSON.stringify([
      { id: 'b/2', state: 'done', stage: 'done' }, { id: 'a/1', state: 'idle', stage: 'todo' },
      { id: 'a/7', state: 'done', stage: 'done' }, { id: 'c/1', state: 'done', stage: 'done' },
    ]))
    expect(sortTasks(rows).map(r => r.id)).toEqual(['a/1', 'b/2', 'a/7', 'c/1'])
    // By repo: each repo's done rows keep that order too.
    expect(groupByRepo(rows).map(g => [g.repo, g.tasks.map(r => r.id)])).toEqual([['a', ['a/1', 'a/7']], ['b', ['b/2']], ['c', ['c/1']]])
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

describe('a task read from its file (wherdr in a container)', () => {
  it('follows the stages as herdr-projects 1.2.1 shows them', () => {
    const st = (t: Record<string, unknown>, pane: string | null = null) => stateFromTaskFile(t, pane)
    expect(st({ stage: 'todo' })).toEqual({ state: 'idle', kind: '' })
    expect(st({ stage: 'approval' })).toEqual({ state: 'blocked', kind: 'permission' })
    expect(st({ stage: 'plan' })).toEqual({ state: 'blocked', kind: 'permission' })
    expect(st({ stage: 'asks', kind: 'auth' })).toEqual({ state: 'blocked', kind: 'auth' })
    expect(st({ stage: 'asks' })).toEqual({ state: 'blocked', kind: 'question' })
    expect(st({ stage: 'failed', failure: { auth: true } })).toEqual({ state: 'blocked', kind: 'auth' })
    expect(st({ stage: 'failed' })).toEqual({ state: 'error', kind: '' })
    expect(st({ stage: 'nosummary' })).toEqual({ state: 'error', kind: '' })
    expect(st({ stage: 'stopped', limitStop: true }).state).toBe('blocked')
    expect(st({ stage: 'stopped' }).state).toBe('idle')
    expect(st({ stage: 'after', afterBlocked: true })).toEqual({ state: 'blocked', kind: 'question' })
    expect(st({ stage: 'reviewing' }).state).toBe('working')
    expect(st({ stage: 'done' }).state).toBe('done')
    // The agent's own turn: what Herdr says of its pane.
    expect(st({ stage: 'working' }, 'blocked').state).toBe('blocked')
    expect(st({ stage: 'working' }, 'working').state).toBe('working')
    expect(st({ stage: 'working' }, null).state).toBe('working')
  })

  it('a row as the list gives it, and nothing for an attempt of another task', () => {
    const r = rowFromTaskFile({ id: 'acme/4', title: 'T', stage: 'approval', app: 'claude', pr: 'https://github.com/o/r/pull/9', review: { meets: true, pass: false, findings: [{ severity: 'major' }] }, reviewRound: 2, watch: { progress: 40 } }, null)
    expect(r).toMatchObject({ id: 'acme/4', group: 'needs', pr: 'https://github.com/o/r/pull/9', reviewRound: 2, progress: 40, review: { pass: false, tally: '1 major' } })
    expect(rowFromTaskFile({ id: 'acme/5', attemptOf: 'acme/4', stage: 'working' }, null)).toBeNull()
    expect(rowFromTaskFile({ id: '../5', stage: 'todo' }, null)).toBeNull()
    expect(rowFromTaskFile({ id: 'acme/6', stage: 'approval', review: { stale: true, meets: true, pass: true, findings: [] } }, null)!.review).toBeNull()
  })

  it('details from the file', () => {
    expect(detailsFromTaskFile({ id: 'acme/4', title: 'T', stage: 'working', description: 'D', on: 'codex', branch: 'b', worktree: '/w', failure: { msg: 'm' } }))
      .toMatchObject({ id: 'acme/4', description: 'D', agent: 'codex', branch: 'b', worktree: '/w', failure: 'm', plan: '' })
    expect(detailsFromTaskFile({ id: 'nope' })).toBeNull()
  })

  it('whether a task is archived, from the file (1.2.1 details leave it out)', () => {
    expect(parseTaskDetails(fixture('details-approval.json')).archived).toBe(false)
    expect(detailsFromTaskFile({ id: 'acme/4', title: 'T', stage: 'done', archivedAt: 1760000000 })!.archived).toBe(true)
    expect(detailsFromTaskFile({ id: 'acme/4', title: 'T', stage: 'done', archivedAt: null })!.archived).toBe(false)
  })

  it('the closing note and a research report, as details or the file give them', () => {
    expect(parseTaskDetails(fixture('details-approval.json'))).toMatchObject({ summary: '', report: null })
    const d = parseTaskDetails(JSON.stringify({ task: { id: 'acme/4', title: 'T' }, summary: ' Done. ', report: { file: 'REPORT.md', link: 'https://example.test/r/REPORT.md', at: 1 } }))
    expect(d).toMatchObject({ summary: 'Done.', report: { file: 'REPORT.md', link: 'https://example.test/r/REPORT.md' } })
    // A local path is not a link: the file's name is kept.
    expect(parseTaskDetails(JSON.stringify({ task: { id: 'acme/4' }, report: { file: 'R.md', link: '/tmp/r/R.md' } })).report).toEqual({ file: 'R.md', link: '' })
    expect(detailsFromTaskFile({ id: 'acme/4', summary: 'All green.', report: { file: 'R.md' } })).toMatchObject({ summary: 'All green.', report: { file: 'R.md', link: '' } })
  })
})

describe('commands, by repo, and push', () => {
  it('a title is one line; a repo is a name or a folder, never a flag', () => {
    expect(cleanTitle('  Fix\n  the   login ')).toBe('Fix the login')
    expect(cleanTitle(3)).toBe('')
    expect(cleanRepo(undefined)).toBe('')
    expect(cleanRepo(' wherdr ')).toBe('wherdr')
    expect(cleanRepo('my.repo-2')).toBe('my.repo-2')
    expect(cleanRepo('/srv/app')).toBe('/srv/app')
    expect(cleanRepo('~/code/app')).toBe('~/code/app')
    for (const bad of ['--all', '-x', '../x', 'a b', '~user/x', '/a\nb', 7]) expect(cleanRepo(bad)).toBeNull()
  })

  it('add and coordinator: the user\'s words as --flag=value or after --', () => {
    expect(addArgs({ title: 'T', description: '', repo: '', delegate: false })).toEqual(['add', '--', 'T'])
    expect(addArgs({ title: '--T', description: '--D', repo: 'r', delegate: true })).toEqual(['add', '--desc=--D', '--repo=r', '--delegate', '--', '--T'])
    expect(coordinatorArgs({ kind: 'main' }, 'w', false)).toEqual(['coordinator', '--', 'tell', 'w'])
    expect(coordinatorArgs({ kind: 'machine' }, 'w', true)).toEqual(['coordinator', '--machine', '--delegate', '--', 'tell', 'w'])
    expect(coordinatorArgs({ kind: 'project', repo: 'wherdr' }, 'w', false)).toEqual(['coordinator', '--project=wherdr', '--', 'tell', 'w'])
    expect(cleanTarget(undefined)).toEqual({ kind: 'main' })
    expect(cleanTarget({ kind: 'project', repo: '/abs' })).toBeNull()
    expect(cleanTarget({ kind: 'nope' })).toBeNull()
  })

  it('a coordinator\'s pane, as herdr-projects keeps it (coordinator status --json)', () => {
    expect(coordinatorStatusArgs({ kind: 'main' })).toEqual(['coordinator', '--json', 'status'])
    expect(coordinatorStatusArgs({ kind: 'machine' })).toEqual(['coordinator', '--machine', '--json', 'status'])
    expect(coordinatorStatusArgs({ kind: 'project', repo: 'demo-2' })).toEqual(['coordinator', '--project=demo-2', '--json', 'status'])
    const st = (o: Record<string, unknown>) => parseCoordinatorStatus(JSON.stringify({ name: 'demo coordinator', agent: 'claude', ...o }))
    for (const state of ['working', 'blocked', 'idle']) expect(st({ state, pane: 'w4:p2' })).toEqual({ state, pane: 'w4:p2', error: '', name: 'demo coordinator', queued: null })
    // No agent answering in it: nothing to talk to.
    for (const state of ['none', 'starting', 'exited']) expect(st({ state, pane: 'w4:p2' }).pane).toBeNull()
    expect(st({ state: 'idle', pane: '' }).pane).toBeNull()
    expect(st({ state: 'idle', pane: '../w1:p1' }).pane).toBeNull()
    expect(() => parseCoordinatorStatus('sent to the Coordinator')).toThrow(/not JSON/)
  })

  it('a failed start: why, as herdr-projects wrote it down, on one line', () => {
    // herdr-projects 1.2.1 after a start that failed: still "starting" (its words wait), never tried again by itself.
    const failed = parseCoordinatorStatus(JSON.stringify({ name: 'Coordinator', state: 'starting', agent: 'claude', pane: 'w1:p3', queued: 1, error: '"claude" is not installed here, so it cannot be the Coordinator.' }))
    expect(failed).toEqual({ state: 'starting', pane: null, error: '"claude" is not installed here, so it cannot be the Coordinator.', name: 'Coordinator', queued: 1 })
    expect(parseCoordinatorStatus(JSON.stringify({ state: 'none', error: '  it could not\n be started  ' })).error).toBe('it could not be started')
    expect(parseCoordinatorStatus(JSON.stringify({ state: 'none', error: 42 })).error).toBe('')
    expect(parseCoordinatorStatus(JSON.stringify({ state: 'none', error: 'x'.repeat(1000) })).error).toHaveLength(400)
    // Older replies, without an error or a name.
    expect(parseCoordinatorStatus(JSON.stringify({ state: 'none', pane: '' }))).toEqual({ state: 'none', pane: null, error: '', name: '', queued: null })
  })

  it('preserves only valid queue counts and leaves missing counts unknown', () => {
    for (const queued of [0, 1, 3]) expect(parseCoordinatorStatus(JSON.stringify({ queued })).queued).toBe(queued)
    for (const queued of [undefined, null, -1, 1.5, '1', true]) expect(parseCoordinatorStatus(JSON.stringify({ queued })).queued).toBeNull()
  })

  it('what the panel shows for a coordinator: its conversation, its failure, its start, or the first-message field', () => {
    const phase = (state: string, pane: string | null = null, error = '') => coordinatorPhase({ state, pane, error })
    // Running, with a pane: its conversation, whatever an earlier error said (an unsent message).
    expect(phase('idle', 'w1:p1')).toBe('live')
    expect(phase('working', 'w1:p1', 'your message sits unsent in its box. Go into it and press enter.')).toBe('live')
    // Given up: the error, never "starting", though herdr-projects still says so while the words wait.
    expect(phase('starting', null, '"claude" is not installed here, so it cannot be the Coordinator.')).toBe('failed')
    for (const state of ['none', 'exited', 'idle', '']) expect(phase(state, null, 'it could not be started')).toBe('failed')
    // On its way.
    expect(phase('starting')).toBe('starting')
    // Not running and nothing wrong: its first message starts it.
    for (const state of ['none', 'exited', 'unknown', '']) expect(phase(state)).toBe('idle')
  })

  it('names each coordinator once: Coordinator, <machine> coordinator, <repo> coordinator', () => {
    expect(coordinatorSubject({ kind: 'main' }, 'devbox', 'Coordinator')).toBe('')
    expect(coordinatorSubject({ kind: 'project', repo: 'wherdr' }, 'devbox', 'wherdr coordinator')).toBe('wherdr')
    // The machine coordinator, as herdr-projects names it (its host name), else wherdr's label.
    expect(coordinatorSubject({ kind: 'machine' }, 'Local', 'devbox coordinator')).toBe('devbox')
    expect(coordinatorSubject({ kind: 'machine' }, 'Local', '')).toBe('Local')
    expect(coordinatorSubject({ kind: 'machine' }, 'Local', 'Coordinator')).toBe('Local')
  })

  it('Try again: the coordinator started again, nothing said (coordinator restart)', () => {
    expect(coordinatorRestartArgs({ kind: 'main' })).toEqual(['coordinator', '--', 'restart'])
    expect(coordinatorRestartArgs({ kind: 'machine' })).toEqual(['coordinator', '--machine', '--', 'restart'])
    expect(coordinatorRestartArgs({ kind: 'project', repo: 'web' })).toEqual(['coordinator', '--project=web', '--', 'restart'])
  })

  it('groups a machine\'s tasks by repo, repos by name, each as the board orders it', () => {
    const rows = parseTaskList(JSON.stringify([
      { id: 'web/1', state: 'done', stage: 'done' }, { id: 'api/2', state: 'idle', stage: 'todo' },
      { id: 'web/7', state: 'blocked', kind: 'question', stage: 'asks' }, { id: 'api/5', state: 'working', stage: 'working' },
    ]))
    expect(groupByRepo(rows).map(g => [g.repo, g.tasks.map(t => t.id)])).toEqual([['api', ['api/5', 'api/2']], ['web', ['web/7', 'web/1']]])
    expect(groupCounts(rows)).toEqual({ needs: 1, ready: 0, working: 1, todo: 1, done: 1 })
    expect(groupByRepo([])).toEqual([])
  })

  it('reads back the notification board.notify sends, and only that', () => {
    expect(taskNotice('wherdr/12 · needs you')).toEqual({ id: 'wherdr/12', event: 'needs you' })
    expect(taskNotice('demo/1 · ready to approve')).toEqual({ id: 'demo/1', event: 'ready to approve' })
    expect(taskNotice('demo/1 · failed')).toEqual({ id: 'demo/1', event: 'failed' })
    expect(taskNotice('Build finished')).toBeNull()
    expect(taskNotice('../x/1 · failed')).toBeNull()
    expect(taskNotice('demo/1 · merged')).toBeNull()
  })

  // 1.2.1 store/keys.rs: `APP-6` with its repo's key, `#6` without one.
  it('names a task by its repo\'s key, as herdr-projects does', () => {
    expect(taskKey('demo-app/6', 'APP')).toBe('APP-6')
    expect(taskKey('demo-app/6')).toBe('#6')
    const show = (row: object) => JSON.stringify({ settings: [{ name: 'check.command', value: 'x' }, { name: 'repo.key', ...row }], problems: [] })
    expect(parseRepoKey(show({ value: 'APP', note: '' }))).toBe('APP')
    // Another repo has or had it: the stand-in its tasks go by.
    expect(parseRepoKey(show({ value: 'KEEP', note: 'not used: another repo has or had the same key; its tasks go by BETA' }))).toBe('BETA')
    expect(parseRepoKey(show({ value: 'KEEP', note: 'not used: another repo has or had the same key' }))).toBe('')
    expect(parseRepoKey(show({ value: 'none', note: '' }))).toBe('')
    expect(parseRepoKey('not json')).toBe('')
    // The record of keys: the last one a repo went by, a stand-in first.
    expect(repoKeysFromFile(JSON.stringify({ had: { DEMO: 'demo-app', APP: 'demo-app', HOME: 'home', KEEP: 'proj' }, standIn: { beta: 'BETA' } })))
      .toEqual({ 'demo-app': 'APP', 'home': 'HOME', 'proj': 'KEEP', 'beta': 'BETA' })
    expect(repoKeysFromFile('{')).toEqual({})
  })

  it('the migration guide gives the same board.notify command as Settings', () => {
    const doc = readFileSync(path.join(import.meta.dirname, '../docs/herdr-projects-1x.md'), 'utf8')
    expect(doc).toContain(NOTIFY_SETUP('~/.herdr-projects/data/bin/herdr-projects'))
  })
})

describe('Start with an agent (delegate --worker.agent, show <id> --json)', () => {
  it('delegate: no agent is the task\'s default, exactly as before; an agent goes before -- as a setting for this task', () => {
    expect(delegateArgs('demo/5')).toEqual(['delegate', '--', 'demo/5'])
    expect(delegateArgs('demo/5', null)).toEqual(['delegate', '--', 'demo/5'])
    expect(delegateArgs('demo/5', 'codex')).toEqual(['delegate', '--worker.agent=codex', '--', 'demo/5'])
  })

  it('an agent name is one plain word, never an option nor a model', () => {
    for (const ok of ['claude', 'codex', 'pi', 'qodercli', 'kimi-code']) expect(isAgentName(ok)).toBe(true)
    for (const bad of ['', '--now', 'codex/gpt-5', 'Claude', 'codex --merge.by=itself', 'a b', 7, null, 'x'.repeat(41)]) expect(isAgentName(bad)).toBe(false)
  })

  it('reads worker.agent and where it comes from in show\'s settings', () => {
    const show = JSON.stringify({ settings: [
      { name: 'worker.effort', kind: 'work', value: 'default', from: 'built in', place: 'builtin', own: false, note: '' },
      { name: 'worker.agent', kind: 'work', value: 'codex/gpt-5.5', from: 'your entry for demo', place: 'repo', own: false, note: '' },
    ], problems: [] })
    expect(parseWorkerAgent(show)).toEqual({ value: 'codex/gpt-5.5', kind: 'codex', place: 'repo', from: 'your entry for demo' })
    expect(agentKind('claude')).toBe('claude')
  })

  it('putting back what the task had: its own value (set), or none (unset)', () => {
    expect(restoreAgentArgs('demo/5', null)).toEqual(['unset', '--task=demo/5', '--', 'worker.agent'])
    expect(restoreAgentArgs('demo/5', 'codex/gpt-5.5')).toEqual(['set', '--task=demo/5', '--', 'worker.agent', 'codex/gpt-5.5'])
  })

  it('a run is over back in the backlog or done; waiting for another task or a slot is still the run', () => {
    expect(runOver({ stage: 'todo', state: 'idle', archived: false })).toBe(true)
    expect(runOver({ stage: 'done', state: 'done', archived: false })).toBe(true)
    for (const stage of ['after', 'queued', 'starting', 'working', 'approval', 'failed', 'stopped']) expect(runOver({ stage, state: 'idle', archived: false })).toBe(false)
    expect(runOver({ stage: 'todo', state: 'idle', archived: true })).toBe(false)
  })

  it('no worker.agent, or not JSON: no default known', () => {
    expect(parseWorkerAgent('{"settings":[]}')).toBeNull()
    expect(parseWorkerAgent('{"settings":[{"name":"worker.agent","value":""}]}')).toBeNull()
    expect(parseWorkerAgent('not json')).toBeNull()
    expect(parseWorkerAgent('[]')).toBeNull()
  })
})
