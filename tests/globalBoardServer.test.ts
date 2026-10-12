// GET /api/board: one project per folder, boards cached per project, and a slow,
// failing or offline project never fails the reply. The state, the machines and
// readProjectBoard are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalBoard } from '../shared/globalBoard'
import { RESOLVED_KEPT } from '../shared/globalBoard'
import type { ProjectBoard, ProjectThread } from '../shared/projectBoard'
import type { MachineInfo, Pane } from '../shared/types'

const env = vi.hoisted(() => ({
  panes: [] as Pane[],
  machines: undefined as MachineInfo[] | undefined,
  read: vi.fn(),
}))

vi.mock('../server/utils/env', () => ({ DATA_DIR: '/tmp/wherdr-test', log: () => {} }))
vi.mock('../server/utils/state', () => ({
  getState: () => ({ panes: env.panes, machines: env.machines }),
  onStateChange: () => {},
}))
vi.mock('../server/utils/machines', () => ({
  getMachine: (key: string) => env.machines?.find(m => m.key === key && m.local === false) && { key, info: () => env.machines!.find(m => m.key === key)! },
  allMachines: () => [],
  baseMachines: () => [],
}))
vi.mock('../server/utils/projectBoard', () => ({ readProjectBoard: env.read }))

const { INFLIGHT_MAX_MS, READ_DEADLINE_MS, REUSE_MS, readGlobalBoard } = await import('../server/utils/globalBoard')

const pane = (id: string, cwd: string, over: Partial<Pane> = {}): Pane => ({
  id, workspace: 'w1', tab: 't1', tabLabel: null, agent: 'claude', status: 'idle', title: null, cwd, agentSession: null, project: 'acme-shop', name: null, ...over,
} as Pane)

const thread = (id: string, resolved: boolean): ProjectThread => ({
  id, title: id, group: resolved ? 'Resolved' : 'Working', token: resolved ? 'resolved' : 'working', rank: resolved ? 6 : 3, resolved,
  updated: '', created: '', agentName: null, machine: '', activity: '', percent: 0, pr: '', report: false,
})
const board = (version: string, over: Partial<ProjectBoard> = {}): ProjectBoard => ({ slug: 'acme-shop', version, lists: [], open: [], resolved: [], ...over })

// Mocked reader: a full board, or `same` when the caller already has that version.
let boards: Record<string, ProjectBoard | { available: false } | Error> = {}
beforeEach(async () => {
  // Only Date is faked: `later()` ages the cache past the reuse window.
  vi.useFakeTimers({ toFake: ['Date'] })
  // The cache outlives a call: an empty state prunes what a previous test left.
  env.panes = []
  await readGlobalBoard()
  boards = {}
  env.machines = undefined
  env.read.mockReset()
  env.read.mockImplementation(async (p: Pane, since?: string) => {
    const b = boards[p.id]
    if (b instanceof Error) throw b
    if (!b) return { available: false }
    if (since && 'version' in b && b.version === since) return { same: true, version: since }
    return b
  })
})
afterEach(() => vi.useRealTimers())

// Moves the clock past the reuse window, so the next poll reads again.
const later = (ms = REUSE_MS + 1) => vi.setSystemTime(Date.now() + ms)
const full = async (since?: string, refresh?: string[]) => await readGlobalBoard(since, refresh) as GlobalBoard

describe('readGlobalBoard', () => {
  it('lists one project per folder with all its coordinator panes, the preferred first', async () => {
    env.panes = [
      pane('w1:p1', '/home/user/code/acme-shop'),
      pane('w2:p1', '/home/user/.herdr-projects/acme-shop'),
      pane('w3:p1', '/home/user/.herdr-projects/acme-shop', { project: 'acme-shop' }),
      pane('w4:p1', '/home/user/.herdr/worktrees/acme-shop/hp-acme-shop-t-0001-fix', { name: 'hp-acme-shop-t-0001' }), // a thread
      pane('w5:p1', '/home/user/.herdr-projects/acme-api', { project: 'acme-api' }),
      pane('w6:p1', '/home/user/notes', { agent: null }),
      pane('w7:p1', 'relative/acme-shop'),
      pane('w8:p1', '/home/user/elsewhere', { project: 'acme-shop' }), // folder is not the project's
    ]
    boards['w2:p1'] = board('v1')
    boards['w5:p1'] = board('v9', { slug: 'acme-api' })
    const r = await full()
    expect(r.projects.map(p => [p.key, p.slug, p.panes])).toEqual([
      ['|/home/user/.herdr-projects/acme-api', 'acme-api', ['w5:p1']],
      ['|/home/user/.herdr-projects/acme-shop', 'acme-shop', ['w2:p1', 'w3:p1']],
      // Same name, other folder: another project, without herdr-projects data here.
      ['|/home/user/code/acme-shop', 'acme-shop', ['w1:p1']],
    ])
    // The two coordinators of one folder share one read, from the preferred pane.
    expect(env.read.mock.calls.map(c => c[0].id).sort()).toEqual(['w1:p1', 'w2:p1', 'w5:p1'])
    expect(r.projects[1]!.board).toMatchObject({ version: 'v1' })
    expect(r.projects[2]!.board).toBeNull()
    expect(r.version).toMatch(/^[0-9a-f]{16}$/)
  })

  it('keeps a named session of the same machine in the same project', async () => {
    env.machines = [
      { key: '', local: true, status: 'online', error: null, label: 'here' },
      { key: 'abcd1234', local: false, status: 'online', error: null, label: 'host-a' },
      { key: 'abcd1234:work', baseKey: 'abcd1234', session: 'work', local: false, status: 'online', error: null, label: 'host-a work' },
    ] as MachineInfo[]
    env.panes = [
      pane('abcd1234~w1:p1', '/home/user/.herdr-projects/acme-shop', { machine: 'abcd1234' }),
      pane('abcd1234:work~w1:p1', '/home/user/.herdr-projects/acme-shop', { machine: 'abcd1234:work' }),
      pane('w1:p1', '/home/user/.herdr-projects/acme-shop'),
    ]
    boards['abcd1234~w1:p1'] = board('r1')
    boards['w1:p1'] = board('l1')
    const r = await full()
    expect(r.projects.map(p => [p.key, p.panes])).toEqual([
      ['abcd1234|/home/user/.herdr-projects/acme-shop', ['abcd1234~w1:p1', 'abcd1234:work~w1:p1']],
      ['|/home/user/.herdr-projects/acme-shop', ['w1:p1']],
    ])
  })

  it('answers {same} for the current version and a new version when a board changed', async () => {
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    boards['w1:p1'] = board('v1')
    const first = await full()
    later()
    expect(await readGlobalBoard(first.version)).toEqual({ same: true, version: first.version })
    // Second read passes the cached board version: the project answers {same}.
    expect(env.read).toHaveBeenLastCalledWith(expect.anything(), 'v1')
    boards['w1:p1'] = board('v2')
    later()
    const next = await full(first.version)
    expect(next.version).not.toBe(first.version)
    expect(next.projects[0]!.board!.version).toBe('v2')
  })

  it('re-reads a refreshed project without its version', async () => {
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    boards['w1:p1'] = board('v1')
    await full()
    await full(undefined, ['|/home/user/.herdr-projects/acme-shop'])
    expect(env.read).toHaveBeenLastCalledWith(expect.anything(), undefined)
    later()
    await full(undefined, ['|/unknown'])
    expect(env.read).toHaveBeenLastCalledWith(expect.anything(), 'v1')
  })

  it('has no board for a project without herdr-projects, and forgets projects that are gone', async () => {
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    boards['w1:p1'] = board('v1')
    expect((await full()).projects[0]!.board).not.toBeNull()
    env.panes = []
    expect((await full()).projects).toEqual([])
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    boards['w1:p1'] = { available: false }
    expect((await full()).projects[0]).toMatchObject({ board: null })
    expect(env.read).toHaveBeenLastCalledWith(expect.anything(), undefined)
  })

  it('shows the last board, stale, for an offline machine without reading it', async () => {
    env.machines = [
      { key: '', local: true, status: 'online', error: null, label: 'here' },
      { key: 'abcd1234', local: false, status: 'online', error: null, label: 'host-a' },
    ] as MachineInfo[]
    env.panes = [pane('abcd1234~w1:p1', '/home/user/.herdr-projects/acme-shop', { machine: 'abcd1234' })]
    boards['abcd1234~w1:p1'] = board('v1')
    const ok = await full()
    env.machines[1]!.status = 'offline'
    env.read.mockClear()
    const off = await full(ok.version)
    expect(env.read).not.toHaveBeenCalled()
    expect(off.projects[0]).toMatchObject({ stale: true, board: { version: 'v1' } })
    expect(off.version).not.toBe(ok.version)
    env.machines[1]!.status = 'online'
    expect((await full()).projects[0]!.stale).toBeUndefined()
  })

  it('has no board for an offline machine never read', async () => {
    env.machines = [
      { key: '', local: true, status: 'online', error: null, label: 'here' },
      { key: 'beef5678', local: false, status: 'connecting', error: null, label: 'host-b' },
    ] as MachineInfo[]
    env.panes = [pane('beef5678~w1:p1', '/home/user/.herdr-projects/acme-shop', { machine: 'beef5678' })]
    expect((await full()).projects[0]).toMatchObject({ board: null, stale: true })
    expect(env.read).not.toHaveBeenCalled()
  })

  it('shows the last board with the error when a read throws, and null when none was read', async () => {
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    boards['w1:p1'] = new Error('Machine host-a is unreachable')
    expect((await full()).projects[0]).toMatchObject({ board: null, stale: true, error: 'Machine host-a is unreachable' })
    boards['w1:p1'] = board('v1')
    expect((await full()).projects[0]).toMatchObject({ board: { version: 'v1' } })
    later()
    boards['w1:p1'] = new Error('ssh: connection refused')
    const bad = (await full()).projects[0]!
    expect(bad).toMatchObject({ board: { version: 'v1' }, stale: true, error: 'ssh: connection refused' })
    boards['w1:p1'] = board('v1')
    later()
    expect((await full()).projects[0]).not.toHaveProperty('stale')
  })

  it('answers within the deadline when a read is slow, then returns the fresh board', async () => {
    vi.useFakeTimers()
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    boards['w1:p1'] = board('v1')
    await full()
    later()
    const slowRead = Promise.withResolvers<ProjectBoard>()
    env.read.mockImplementation(() => slowRead.promise)
    const slow = full()
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS)
    const late = (await slow).projects[0]!
    expect(late).toMatchObject({ stale: true, board: { version: 'v1' } })
    expect(late.error).toBe('Board read timed out')
    // A second poll joins the read in progress instead of starting another one.
    const again = full()
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS)
    await again
    expect(env.read).toHaveBeenCalledTimes(2)
    slowRead.resolve(board('v2'))
    await vi.advanceTimersByTimeAsync(0)
    later()
    env.read.mockImplementation(async (_p: Pane, since?: string) => (since === 'v2' ? { same: true, version: 'v2' } : board('v2')))
    const fresh = (await full()).projects[0]!
    expect(fresh).toMatchObject({ board: { version: 'v2' } })
    expect(fresh).not.toHaveProperty('stale')
    expect(env.read).toHaveBeenLastCalledWith(expect.anything(), 'v2')
  })

  it('keeps the most recent resolved threads and counts them all', async () => {
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    const resolved = Array.from({ length: RESOLVED_KEPT + 5 }, (_, i) => thread(`t-${String(i + 1).padStart(4, '0')}`, true))
    boards['w1:p1'] = board('v1', { open: [thread('t-0100', false)], resolved })
    const p = (await full()).projects[0]!
    expect(p.board!.resolved.map(t => t.id)).toEqual(resolved.slice(0, RESOLVED_KEPT).map(t => t.id))
    expect(p.resolvedTotal).toBe(RESOLVED_KEPT + 5)
    expect(p.board!.open).toHaveLength(1)
    // A short list is untouched.
    boards['w1:p1'] = board('v2', { resolved: resolved.slice(0, 2) })
    later()
    const small = (await full()).projects[0]!
    expect(small.board!.resolved).toHaveLength(2)
    expect(small.resolvedTotal).toBe(2)
  })

  it('changes the version when the content changes under the same stat version', async () => {
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    boards['w1:p1'] = board('v1', { open: [thread('t-0001', false)] })
    const first = await full()
    // Same content: same version, {same} answer.
    later()
    boards['w1:p1'] = board('v1', { open: [thread('t-0001', false)] })
    expect((await full(undefined, ['|/home/user/.herdr-projects/acme-shop'])).version).toBe(first.version)
    // Same board.version, other threads: a full re-read must change the version.
    boards['w1:p1'] = board('v1', { open: [thread('t-0001', false), thread('t-0002', false)] })
    const next = await full(first.version, ['|/home/user/.herdr-projects/acme-shop'])
    expect(next.version).not.toBe(first.version)
    expect(next.projects[0]!.board!.open).toHaveLength(2)
  })

  it('reuses a board read less than REUSE_MS ago unless the project is refreshed', async () => {
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    boards['w1:p1'] = board('v1')
    await full()
    vi.setSystemTime(Date.now() + REUSE_MS - 1)
    await full()
    expect(env.read).toHaveBeenCalledTimes(1)
    await full(undefined, ['|/home/user/.herdr-projects/acme-shop'])
    expect(env.read).toHaveBeenCalledTimes(2)
    later()
    await full()
    expect(env.read).toHaveBeenCalledTimes(3)
  })

  it('drops a read that never settles after INFLIGHT_MAX_MS and starts a new one', async () => {
    vi.useFakeTimers()
    env.panes = [pane('w1:p1', '/home/user/.herdr-projects/acme-shop')]
    env.read.mockImplementation(() => new Promise(() => {}))
    const hung = full()
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS)
    expect((await hung).projects[0]).toMatchObject({ board: null, stale: true })
    expect(env.read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(INFLIGHT_MAX_MS)
    env.read.mockImplementation(async () => board('v1'))
    expect((await full()).projects[0]).toMatchObject({ board: { version: 'v1' } })
    expect(env.read).toHaveBeenCalledTimes(2)
  })
})
