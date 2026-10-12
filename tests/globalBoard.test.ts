import { describe, expect, it } from 'vitest'
import type { Pane } from '../shared/types'
import type { ProjectBoard, ProjectThread } from '../shared/projectBoard'
import {
  type BoardCard, type BoardProject, boardMoveMessage, boardMoves, boardProjectsOf, buildGlobalBoard, capFinished, filterBoard, paneColumn, rollUp, taskColumn, threadColumn,
} from '../shared/globalBoard'
import { pickCoordinator } from '../shared/projects'

let n = 0
const pane = (o: Partial<Pane> = {}): Pane => ({
  id: `w${++n}:p1`, workspace: `w${n}`, tab: `w${n}:t1`, tabLabel: null,
  agent: 'claude', name: null, label: null, status: 'idle',
  title: 'Claude', cwd: '/home/user/code/app', agentSession: null,
  ...o,
})
const coord = (slug: string, o: Partial<Pane> = {}) => pane({ cwd: `/home/user/.herdr-projects/${slug}`, project: slug, ...o })
const threadPane = (slug: string, id: string, o: Partial<Pane> = {}) =>
  pane({ name: `hp-${slug}-${id}-topic`, cwd: `/home/user/.herdr/worktrees/app/hp-${slug}-${id}-topic`, project: slug, hpThread: `${slug}/${id}`, ...o })
const thread = (id: string, o: Partial<ProjectThread> = {}): ProjectThread => ({
  id, title: `Thread ${id}`, group: 'Working', token: 'working', rank: 3, resolved: false,
  updated: '2026-10-01T10:00:00Z', created: '2026-10-01T09:00:00Z', agentName: null, machine: '',
  activity: '', percent: null, pr: '', report: false, ...o,
})
const board = (o: Partial<ProjectBoard> = {}): ProjectBoard => ({ slug: 'shop', lists: [], open: [], resolved: [], version: 'v1', ...o })
const project = (c: Pane, b: ProjectBoard | null, o: Partial<BoardProject> = {}): BoardProject =>
  ({ key: `|${c.cwd}`, slug: b?.slug || 'shop', panes: [c.id], board: b, ...o })
const by = (cards: BoardCard[], kind: BoardCard['kind']) => cards.filter(c => c.kind === kind)

describe('columns', () => {
  it('agent panes: Your turn is Blocked, working and starting are Ongoing, the rest Finished', () => {
    expect(paneColumn(pane({ status: 'blocked' }))).toBe('blocked')
    expect(paneColumn(pane({ status: 'working' }))).toBe('ongoing')
    expect(paneColumn(pane({ status: 'unknown', pendingPrompt: true }))).toBe('ongoing')
    expect(paneColumn(pane({ agent: null, status: null, restart: { phase: 'starting', agent: 'codex' } }))).toBe('ongoing')
    expect(paneColumn(pane({ status: 'idle', restart: { phase: 'failed', agent: 'codex' } }))).toBe('finished')
    for (const status of ['done', 'idle', 'unknown'] as const) expect(paneColumn(pane({ status }))).toBe('finished')
  })

  it('tasks: by TASKS.md list, the user\'s checks in To do, checked lines Finished', () => {
    expect(taskColumn('blocked', { done: false })).toBe('blocked')
    expect(taskColumn('doing', { done: false })).toBe('ongoing')
    expect(taskColumn('done', { done: false })).toBe('finished')
    expect(taskColumn('todo', { done: true })).toBe('finished')
    for (const kind of ['test', 'decide', 'review', 'queue', 'todo', 'backlog', null] as const) {
      expect(taskColumn(kind, { done: false })).toBe('todo')
    }
  })

  it('threads: the live pane wins over the herdr-projects token', () => {
    expect(threadColumn(thread('t-0001', { token: 'working' }), [pane({ status: 'blocked' })])).toBe('blocked')
    expect(threadColumn(thread('t-0001', { token: 'ready-for-review' }), [pane({ status: 'working' })])).toBe('ongoing')
    expect(threadColumn(thread('t-0001', { token: 'waiting-on-you' }), [pane({ status: 'idle' })])).toBe('blocked')
    expect(threadColumn(thread('t-0001', { token: 'ready-for-review' }), [])).toBe('todo')
    for (const token of ['working', 'landing', 'idle', 'later']) expect(threadColumn(thread('t-0001', { token }), [])).toBe('ongoing')
    expect(threadColumn(thread('t-0001', { resolved: true, token: 'resolved' }), [pane({ status: 'blocked' })])).toBe('finished')
  })

  it('a project takes its most urgent column: Blocked, Ongoing, To do, then Finished', () => {
    expect(rollUp(['finished', 'todo', 'ongoing'])).toBe('ongoing')
    expect(rollUp(['todo', 'blocked', 'ongoing'])).toBe('blocked')
    expect(rollUp(['finished', 'todo'])).toBe('todo')
    expect(rollUp([])).toBe('finished')
  })
})

describe('moves', () => {
  const targets = (kind: Parameters<typeof boardMoves>[0], done = false) => Object.fromEntries(boardMoves(kind, done).map(m => [m.to, m.action]))

  it('reuses the Project panel messages, and Board moves elsewhere', () => {
    expect(targets('todo')).toEqual({ blocked: 'block', ongoing: 'now', finished: 'done' })
    expect(targets('queue')).toEqual({ blocked: 'block', ongoing: 'now', finished: 'done' })
    expect(targets(null)).toEqual({ blocked: 'block', ongoing: 'now', finished: 'done' })
    expect(targets('backlog')).toEqual({ blocked: 'block', ongoing: 'launch', finished: 'done' })
    expect(targets('blocked')).toEqual({ todo: 'todo', ongoing: 'unblock', finished: 'done' })
    expect(targets('doing')).toEqual({ blocked: 'block', todo: 'todo', finished: 'done' })
    expect(targets('test')).toEqual({ finished: 'tested' })
    expect(targets('review')).toEqual({ finished: 'reviewed' })
  })

  it('To decide needs an answer, a done task can only be reopened', () => {
    expect(boardMoves('decide', false)).toEqual([])
    expect(targets('done')).toEqual({ todo: 'todo' })
    expect(targets('todo', true)).toEqual({ todo: 'todo' })
  })

  it('never offers the column the card is already in', () => {
    for (const kind of ['test', 'decide', 'review', 'doing', 'queue', 'blocked', 'todo', 'backlog', 'done', null] as const) {
      for (const done of [false, true]) {
        const here = taskColumn(kind, { done })
        expect(boardMoves(kind, done).map(m => m.to)).not.toContain(here)
      }
    }
  })

  it('writes the message the coordinator expects, in both languages', () => {
    expect(boardMoveMessage('block', 'Export CSV', 'en')).toBe('↳ Mark blocked: Export CSV')
    expect(boardMoveMessage('now', 'Export CSV', 'en')).toBe('↳ Launch now: Export CSV')
    expect(boardMoveMessage('launch', 'Export CSV', 'fr')).toBe('↳ Lancer : Export CSV')
    expect(boardMoveMessage('unblock', 'Export CSV', 'en')).toBe('↳ Unblock: Export CSV')
    expect(boardMoveMessage('tested', 'Export CSV', 'en')).toBe('✓ Tested: Export CSV')
    expect(boardMoveMessage('reviewed', 'Export CSV', 'fr')).toBe('✓ Relu : Export CSV')
    expect(boardMoveMessage('done', 'Export CSV', 'fr')).toBe('↳ Marquer fait : Export CSV')
  })
})

describe('buildGlobalBoard', () => {
  it('shows every agent pane on exactly one card, shells left out', () => {
    const c = coord('shop')
    const t1 = threadPane('shop', 't-0001', { status: 'working' })
    const tab = pane({ cwd: c.cwd, project: 'shop', hpThread: 'shop/t-0002', status: 'blocked' }) // thread opened as a tab: no name
    const extra = coord('shop', { id: 'x:extra', status: 'blocked' }) // a 2nd agent in the project folder
    const loose = pane({ status: 'working' })
    const shell = pane({ agent: null, status: null })
    const panes = [c, t1, tab, extra, loose, shell]
    const cards = buildGlobalBoard([project(c, board({ open: [thread('t-0001'), thread('t-0002')] }))], panes)
    const shown = cards.flatMap(x => (x.kind === 'project' ? [x.coordinator] : x.kind === 'thread' ? x.panes : x.kind === 'agent' ? [x.pane] : []))
    expect(shown.map(p => p.id).sort()).toEqual([c, t1, tab, extra, loose].map(p => p.id).sort())
    const threads = by(cards, 'thread') as Extract<BoardCard, { kind: 'thread' }>[]
    expect(threads.map(x => [x.thread.id, x.panes.map(p => p.id), x.column])).toEqual([['t-0001', [t1.id], 'ongoing'], ['t-0002', [tab.id], 'blocked']])
  })

  it('finds a thread pane without its token by name, on the coordinator\'s machine first', () => {
    const c = coord('shop', { machine: 'm1' })
    const far = pane({ name: 'hp-shop-t-0003-x', machine: 'm2', status: 'blocked' })
    const near = pane({ name: 'hp-shop-t-0003-x', machine: 'm1', status: 'working' })
    const cards = buildGlobalBoard([project(c, board({ open: [thread('t-0003', { agentName: 'hp-shop-t-0003-x' })] }))], [c, far, near])
    const th = by(cards, 'thread')[0] as Extract<BoardCard, { kind: 'thread' }>
    expect(th.panes.map(p => p.id)).toEqual([near.id])
    expect((by(cards, 'agent') as Extract<BoardCard, { kind: 'agent' }>[]).map(a => a.pane.id)).toEqual([far.id])
  })

  it('two folders with the same project name: each thread pane goes to its own machine\'s project', () => {
    const a = coord('shop', { machine: 'm1' })
    const b = coord('shop', { machine: 'm2' })
    const onA = threadPane('shop', 't-0001', { machine: 'm1', status: 'working' })
    const onB = threadPane('shop', 't-0001', { machine: 'm2', status: 'blocked' })
    const projects = [project(b, board(), { key: 'm2|b', panes: [b.id] }), project(a, board(), { key: 'm1|a', panes: [a.id] })]
    for (const p of projects) p.board = board({ open: [thread('t-0001')] })
    const threads = by(buildGlobalBoard(projects, [onB, a, b, onA]), 'thread') as Extract<BoardCard, { kind: 'thread' }>[]
    expect(threads.map(x => [x.segment, x.panes.map(p => p.id), x.column])).toEqual([['m1|a', [onA.id], 'ongoing'], ['m2|b', [onB.id], 'blocked']])
  })

  it('a pane still at work on a resolved thread stays its own card', () => {
    const c = coord('shop')
    const busy = threadPane('shop', 't-0004', { status: 'working' })
    const cards = buildGlobalBoard([project(c, board({ resolved: [thread('t-0004', { resolved: true, token: 'resolved' })] }))], [c, busy])
    expect(by(cards, 'thread').map(x => x.column)).toEqual(['finished'])
    expect(by(cards, 'agent').map(x => [x.key, x.column, x.segment])).toEqual([[`pane:${busy.id}`, 'ongoing', `|${c.cwd}`]])
  })

  it('tasks follow the Project panel: an In progress line of an open thread shows as that thread', () => {
    const c = coord('shop')
    const md = { lists: [
      { title: 'In progress', kind: 'doing' as const, tasks: [
        { text: 'Checkout', done: false, owner: 'agent → t-0005', thread: 't-0005' },
        { text: 'Search', done: false, owner: 'agent', thread: null },
      ] },
      { title: 'Blocked', kind: 'blocked' as const, tasks: [{ text: 'Publish', done: false, owner: 'me', thread: null }] },
      { title: 'To decide', kind: 'decide' as const, tasks: [{ text: 'Keep the old layout?', done: false, owner: 'me', thread: null }] },
      { title: 'Done', kind: 'done' as const, tasks: [{ text: 'Login', done: true, owner: 'agent', thread: null }] },
    ] }
    const cards = buildGlobalBoard([project(c, board({ ...md, open: [thread('t-0005')] }))], [c])
    const tasks = by(cards, 'task') as Extract<BoardCard, { kind: 'task' }>[]
    expect(tasks.map(x => [x.task.text, x.column, x.listTitle])).toEqual([
      ['Keep the old layout?', 'todo', 'To decide'], ['Search', 'ongoing', 'In progress'], ['Publish', 'blocked', 'Blocked'], ['Login', 'finished', 'Done'],
    ])
    expect(tasks.every(x => x.coordinator === c)).toBe(true)
    // The project card rolls up its cards and counts them.
    const p = by(cards, 'project')[0] as Extract<BoardCard, { kind: 'project' }>
    expect(p.column).toBe('blocked')
    expect(p.counts).toEqual({ blocked: 1, todo: 1, ongoing: 2, finished: 1 })
  })

  it('orders projects by name, the project card first, agents outside projects last', () => {
    const b = coord('beta')
    const a = coord('Alpha')
    const loose = pane()
    const stray = threadPane('gamma', 't-0001') // a project without a coordinator here
    const cards = buildGlobalBoard([project(b, board({ slug: 'beta' })), project(a, board({ slug: 'Alpha' }))], [loose, b, stray, a])
    expect(cards.map(x => [x.kind, x.project])).toEqual([['project', 'Alpha'], ['project', 'beta'], ['agent', 'gamma'], ['agent', null]])
  })

  it('a coordinator without a server answer yet still gets its project card', () => {
    const c = coord('shop', { status: 'working' })
    const t = threadPane('shop', 't-0001', { status: 'blocked' })
    const cards = buildGlobalBoard(null, [c, t])
    expect(cards.map(x => [x.kind, x.column])).toEqual([['project', 'blocked'], ['agent', 'blocked']])
    expect((cards[0] as Extract<BoardCard, { kind: 'project' }>).board).toBeNull()
  })

  it('drops a project of a session this device does not show', () => {
    const c = coord('shop')
    const cards = buildGlobalBoard([project(c, board(), { panes: ['other~w1:p1'] })], [])
    expect(cards).toEqual([])
  })

  it('uses the first coordinator of the folder this device shows', () => {
    const c = coord('shop', { id: 'named~w1:p1' })
    const cards = buildGlobalBoard([project(c, board(), { panes: ['main~w1:p1', c.id] })], [c])
    expect((cards[0] as Extract<BoardCard, { kind: 'project' }>).coordinator).toBe(c)
  })
})

describe('capFinished', () => {
  it('keeps the first n resolved threads and done tasks of each project', () => {
    const c = coord('shop')
    const resolved = ['t-0001', 't-0002', 't-0003'].map(id => thread(id, { resolved: true, token: 'resolved' }))
    const lists = [{ title: 'Done', kind: 'done' as const, tasks: ['a', 'b', 'c'].map(text => ({ text, done: true, owner: null, thread: null })) }]
    const done = pane({ status: 'done' })
    const cards = buildGlobalBoard([project(c, board({ resolved, lists }))], [c, done])
    const { cards: kept, hidden } = capFinished(cards, 2)
    expect(hidden).toBe(2)
    expect(kept.filter(x => x.kind === 'thread').map(x => (x as Extract<BoardCard, { kind: 'thread' }>).thread.id)).toEqual(['t-0001', 't-0002'])
    expect(kept.filter(x => x.kind === 'task').map(x => (x as Extract<BoardCard, { kind: 'task' }>).task.text)).toEqual(['a', 'b'])
    expect(kept.some(x => x.kind === 'agent')).toBe(true)
  })
})

describe('project filter', () => {
  const setup = () => {
    const shop = coord('shop')
    const api = coord('api', { machine: 'm1' })
    const worker = pane({ cwd: '/home/user/.herdr-projects/api/x', project: 'api', machine: 'm1', status: 'working' })
    const loose = pane({ status: 'working' })
    const lists = [{ title: 'To do', kind: 'todo' as const, tasks: [{ text: 'a', done: false, owner: null, thread: null }] }]
    const cards = buildGlobalBoard([project(shop, board({ lists })), project(api, board({ slug: 'api' }), { slug: 'api' })], [shop, api, worker, loose])
    return { cards, worker, loose }
  }

  it('lists each project once, in Board order, with the agents outside projects last', () => {
    const { cards } = setup()
    expect(boardProjectsOf(cards).map(e => [e.id, e.name, e.machine])).toEqual([['m1|api', 'api', 'm1'], ['|shop', 'shop', ''], ['', null, '']])
  })

  it('drops every card of a hidden project, and the outside agents under the empty id', () => {
    const { cards, worker, loose } = setup()
    const noShop = filterBoard(cards, new Set(['|shop']))
    expect(noShop.some(c => c.project === 'shop')).toBe(false)
    expect(noShop.some(c => c.kind === 'agent' && c.pane === worker)).toBe(true)
    const noOutside = filterBoard(cards, new Set(['']))
    expect(noOutside.some(c => c.kind === 'agent' && c.pane === loose)).toBe(false)
    expect(noOutside.filter(c => c.kind === 'project')).toHaveLength(2)
  })

  it('ignores ids of projects no longer on the Board', () => {
    const { cards } = setup()
    expect(filterBoard(cards, new Set(['m9|gone']))).toEqual(cards)
  })

  it('one entry for two folders of the same name on one machine, hiding both', () => {
    const a = coord('shop')
    const b = coord('Shop', { cwd: '/home/user/work/.herdr-projects/Shop' })
    const cards = buildGlobalBoard([project(a, board(), { key: '|a' }), project(b, board({ slug: 'Shop' }), { key: '|b', slug: 'Shop' })], [a, b])
    expect(by(cards, 'project')).toHaveLength(2)
    expect(boardProjectsOf(cards).map(e => e.id)).toEqual(['|shop'])
    expect(filterBoard(cards, new Set(['|shop']))).toEqual([])
  })
})

describe('pickCoordinator', () => {
  it('prefers the machine, then the project folder, then list order', () => {
    const other = coord('shop', { cwd: '/home/user/.herdr-projects/shop/notes', machine: 'm1' })
    const home = coord('shop', { machine: 'm2' })
    const local = coord('shop', { cwd: '/srv/shop-tools', machine: 'm1' })
    expect(pickCoordinator([other, home, local], 'SHOP')).toBe(home)
    expect(pickCoordinator([other, home, local], 'shop', 'm1')).toBe(other)
    expect(pickCoordinator([threadPane('shop', 't-0001')], 'shop')).toBeNull()
  })
})
