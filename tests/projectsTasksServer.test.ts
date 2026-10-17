// server/utils/projectsTasks.ts with the launcher replaced by recorded output:
// which commands run, one at a time per machine, and how sparingly.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'recordings/herdr-projects-1.2.1', name), 'utf8')

const machine = { key: '', label: 'devbox', local: true, status: 'online', home: '/home/user', exec: null, sock: () => null, fs: { readFile: vi.fn(async () => { throw new Error('missing') }) } }
const info = { status: 'ready', version: '1.2.1', launcher: '/plugins/herdr-projects/bin/run.sh' }
vi.mock('../server/utils/machines', () => ({ allMachines: () => [machine] }))
vi.mock('../server/utils/actions', () => ({ machineFor: () => machine }))
vi.mock('../server/utils/projectsPlugin', () => ({ projectsPluginInfo: async () => info }))
vi.mock('../server/utils/state', () => ({
  findPane: (id: string) => (id === 'w3:p1' ? { id } : null),
  getState: () => ({ panes: [{ id: 'w5:p1', machine: '', agent: 'codex', cwd: '/home/user/code/demo-wt/1' }] }),
}))
vi.mock('../server/utils/env', () => ({ HERDR_BIN: 'herdr', HERDR_CHILD_ENV: {}, log: () => {} }))

const T = await import('../server/utils/projectsTasks')

let calls: string[][]
let active = 0
let maxActive = 0
let delay = 0
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  calls = []
  active = maxActive = 0
  delay = 0
  info.status = 'ready'
  T.setRunner(async (_m, launcher, args) => {
    expect(launcher).toBe('/plugins/herdr-projects/bin/run.sh')
    calls.push(args)
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(r => setTimeout(r, delay))
    active--
    if (args[0] === 'list') return { code: 0, stdout: fixture('list.json'), stderr: '' }
    if (args[0] === 'details') return { code: 0, stdout: fixture('details-approval.json'), stderr: '' }
    if (args[0] === 'approve') return { code: 1, stdout: '', stderr: 'demo/1: its pull request\'s checks failed\nmore' }
    return { code: 0, stdout: `${args[args.length - 2]}: sent\n`, stderr: '' }
  })
})
afterEach(() => {
  vi.useRealTimers()
  T.setRunner(null)
})

describe('the Board read', () => {
  it('lists every machine\'s tasks, then reuses the list for a few seconds', async () => {
    const r = await T.readTasksBoard()
    expect('machines' in r && r.machines[0]).toMatchObject({ machine: '', status: 'ready', version: '1.2.1' })
    expect('machines' in r && r.machines[0]!.tasks).toHaveLength(4)
    expect(calls).toEqual([['list', '--json']])
    const again = await T.readTasksBoard(('version' in r && r.version) || '')
    expect(again).toEqual({ same: true, version: (r as { version: string }).version })
    expect(calls).toHaveLength(1)
    vi.setSystemTime(Date.now() + T.REUSE_MS + 1)
    await T.readTasksBoard()
    expect(calls).toHaveLength(2)
  })

  it('a machine without herdr-projects 1.2.1 runs nothing and says so', async () => {
    info.status = 'old'
    vi.setSystemTime(Date.now() + 60_000)
    const r = await T.readTasksBoard()
    expect('machines' in r && r.machines[0]).toMatchObject({ status: 'old', tasks: [] })
    expect(calls).toEqual([])
  })
})

describe('actions on a task', () => {
  it('puts the user\'s words after --, so they are never read as flags', async () => {
    vi.setSystemTime(Date.now() + 60_000)
    await T.readTasksBoard()
    await T.tellTask('', 'demo/3', '--delegate now')
    await T.tellCoordinator('', '--now please')
    expect(calls.slice(1)).toEqual([['tell', '--', 'demo/3', '--delegate now'], ['coordinator', '--', 'tell', '--now please']])
  })

  it('refuses what the task cannot take, before running anything', async () => {
    vi.setSystemTime(Date.now() + 120_000)
    await T.readTasksBoard()
    calls = []
    await expect(T.tellTask('', 'demo/4', 'hi')).rejects.toThrow(/no agent/)
    await expect(T.approveTask('', 'demo/2')).rejects.toThrow(/does not wait/)
    await expect(T.tellTask('', '../x', 'hi')).rejects.toThrow(/Invalid task/)
    await expect(T.tellTask('', 'demo/2', 'hi')).rejects.toThrow(/no agent/)
    await expect(T.tellTask('', 'demo/3', '   ')).rejects.toThrow(/Nothing to send/)
    expect(calls).toEqual([])
  })

  it('gives the first line of a refusal', async () => {
    vi.setSystemTime(Date.now() + 180_000)
    await T.readTasksBoard()
    await expect(T.approveTask('', 'demo/1')).rejects.toThrow('demo/1: its pull request\'s checks failed')
  })

  it('finds the agent\'s pane by its worktree when the task file is elsewhere', async () => {
    const d = await T.taskDetails('', 'demo/1')
    expect(d).toMatchObject({ id: 'demo/1', pane: 'w5:p1' })
    expect(calls.at(-1)).toEqual(['details', '--json', '--', 'demo/1'])
  })

  it('runs one command at a time on a machine', async () => {
    delay = 20
    vi.useRealTimers()
    await Promise.all([T.taskDetails('', 'demo/1'), T.tellCoordinator('', 'a'), T.tellCoordinator('', 'b')])
    expect(maxActive).toBe(1)
  })
})
