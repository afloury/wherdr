// server/utils/projectsTasks.ts with the launcher replaced by recorded output:
// which commands run, one at a time per machine, how sparingly, in which
// session, what a failure looks like, and nothing run from a container.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localFs } from '../server/utils/fsx'

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'recordings/herdr-projects-1.2.1', name), 'utf8')

// A HOME with a board on disk, for the container read.
const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-tasks-'))
afterAll(() => rmSync(home, { recursive: true, force: true }))
function taskFile(id: string, t: Record<string, unknown>) {
  const dir = path.join(home, '.herdr-projects/data/tasks', ...id.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ id, ...t }))
}

// The local machine, and a named session of it ("review"): one board.
// `fault`: what the disk does wrong for the container read.
let fault: '' | 'eacces' = ''
const fs = { ...localFs, readdir: async (p: string) => {
  if (fault === 'eacces') throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
  return localFs.readdir(p)
} }
const machine = { key: '', label: 'devbox', local: true, status: 'online', home, session: 'default', exec: null, sock: () => null, fs, info: () => ({ key: '' }) }
const session = { ...machine, key: 'abcd1234', session: 'review', info: () => ({ key: 'abcd1234', baseKey: '' }) }
const info = { status: 'ready', version: '1.2.1', launcher: '/plugins/herdr-projects/bin/run.sh' }
let infoFails = false
const infoAsked: boolean[] = []
const panes: { id: string, machine?: string, agent?: string, cwd?: string, status?: string }[] = []
vi.mock('../server/utils/machines', () => ({ allMachines: () => [machine, session], baseMachines: () => [machine] }))
vi.mock('../server/utils/actions', () => ({ machineFor: (k: unknown) => (k === session.key ? session : machine) }))
vi.mock('../server/utils/projectsPlugin', () => ({ projectsPluginInfo: async (_m: unknown, fresh = false) => {
  infoAsked.push(fresh)
  if (infoFails) throw new Error('Herdr did not answer')
  return info
} }))
vi.mock('../server/utils/state', () => ({
  findPane: (id: string) => panes.find(p => p.id === id) || null,
  getState: () => ({ panes }),
}))
vi.mock('../server/utils/env', () => ({ HERDR_BIN: 'herdr', HERDR_CHILD_ENV: {}, IN_DOCKER: false, log: () => {} }))

const T = await import('../server/utils/projectsTasks')

let calls: string[][]
let active = 0
let maxActive = 0
let delay = 0
let listReply: { code: number, stdout: string, stderr: string } | null = null
let clock = Date.now()
const later = (ms = 60_000) => { clock += ms; vi.setSystemTime(clock) }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  later()
  calls = []
  active = maxActive = 0
  delay = 0
  listReply = null
  infoFails = false
  info.status = 'ready'
  panes.length = 0
  T.setInContainer(false)
  T.resetTasksCache()
  fault = ''
  rmSync(path.join(home, '.herdr-projects'), { recursive: true, force: true })
  T.setRunner(async (_m, launcher, args) => {
    expect(launcher).toBe('/plugins/herdr-projects/bin/run.sh')
    calls.push(args)
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(r => setTimeout(r, delay))
    active--
    if (args[0] === 'list') return listReply || { code: 0, stdout: fixture('list.json'), stderr: '' }
    if (args[0] === 'details') return { code: 0, stdout: fixture('details-approval.json'), stderr: '' }
    if (args[0] === 'approve') return { code: 1, stdout: '', stderr: 'demo/1: its pull request\'s checks failed\nmore' }
    return { code: 0, stdout: `${args[args.length - 2]}: sent\n`, stderr: '' }
  })
})
afterEach(() => {
  vi.useRealTimers()
  T.setRunner(null)
  T.setInContainer(null)
})

type Board = { version: string, machines: { machine: string, status: string, tasks: { id: string, group: string }[], at?: number, error?: string, stale?: boolean, readOnly?: boolean }[] }
const read = async (since?: string) => (await T.readTasksBoard(since)) as Board

describe('the Board read', () => {
  it('lists every machine\'s tasks, then reuses the list for a few seconds', async () => {
    const r = await read()
    expect(r.machines[0]).toMatchObject({ machine: '', status: 'ready', version: '1.2.1', at: clock })
    expect(r.machines[0]!.tasks).toHaveLength(4)
    expect(calls).toEqual([['list', '--json']])
    expect(await T.readTasksBoard(r.version)).toEqual({ same: true, version: r.version })
    expect(calls).toHaveLength(1)
    later(T.REUSE_MS + 1)
    await read()
    expect(calls).toHaveLength(2)
  })

  it('one board per machine: its named sessions add no second list nor second read', async () => {
    const r = await read()
    expect(r.machines.map(m => m.machine)).toEqual([''])
    expect(calls).toEqual([['list', '--json']])
  })

  it('checks the plugin afresh when the Board opens, not on every poll', async () => {
    infoAsked.length = 0
    const r = await read()
    await read(r.version)
    // Fresh once, when the Board opens; the poll and the command's launcher use the cache.
    expect(infoAsked[0]).toBe(true)
    expect(infoAsked.slice(1).every(f => !f)).toBe(true)
  })

  it('a machine without herdr-projects 1.2.1 runs nothing and says so', async () => {
    info.status = 'old'
    const r = await read()
    expect(r.machines[0]).toMatchObject({ status: 'old', tasks: [] })
    expect(calls).toEqual([])
  })
})

describe('a read that fails is said, with the last tasks dated and marked', () => {
  it('a refusal or a time-out, before any good read: the error, no tasks', async () => {
    T.setRunner(async (_m, _l, args) => { calls.push(args); return { code: 1, stdout: '', stderr: 'herdr-projects did not answer within 30 s' } })
    const r = await read()
    expect(r.machines[0]).toMatchObject({ status: 'ready', tasks: [], error: 'herdr-projects did not answer within 30 s' })
    expect(r.machines[0]!.stale).toBeFalsy()
  })

  it('output that is not the list: the error, and the tasks of the last good read, marked with when', async () => {
    const good = await read()
    const goodAt = good.machines[0]!.at
    later(T.REUSE_MS + 1)
    listReply = { code: 0, stdout: 'Not JSON at all', stderr: '' }
    const r = await read()
    expect(r.machines[0]).toMatchObject({ error: 'herdr-projects list: not JSON', stale: true, at: goodAt })
    expect(r.machines[0]!.tasks).toHaveLength(4)
  })

  it('Herdr not answering for the plugin: the machine stays, with the error', async () => {
    await read()
    later(T.REUSE_MS + 1)
    infoFails = true
    const r = await read()
    expect(r.machines[0]).toMatchObject({ machine: '', status: 'error', error: 'Herdr did not answer', stale: true })
    expect(r.machines[0]!.tasks).toHaveLength(4)
  })
})

describe('wherdr in a container: the board is read from its files, nothing runs', () => {
  it('reads the task files, with the state herdr-projects would show, and runs no command', async () => {
    T.setInContainer(true)
    taskFile('acme/1', { title: 'Review me', stage: 'approval', app: 'claude', pr: 'https://github.com/o/r/pull/3', review: { meets: true, pass: true, findings: [] } })
    taskFile('acme/2', { title: 'At work', stage: 'working', app: 'codex', link: { socket: '/h/.config/herdr/sessions/review/herdr.sock', pane: 'w2:p1' } })
    taskFile('acme/3', { title: 'Archived', stage: 'done', archivedAt: 1 })
    panes.push({ id: 'abcd1234~w2:p1', status: 'blocked' })
    const r = await read()
    expect(r.machines[0]).toMatchObject({ status: 'ready', readOnly: true })
    expect(Object.fromEntries(r.machines[0]!.tasks.map(t => [t.id, t.group]))).toEqual({ 'acme/1': 'ready', 'acme/2': 'needs' })
    expect(calls).toEqual([])
    // The agent's pane, in the session its task names.
    expect(await T.taskDetails('', 'acme/2')).toMatchObject({ id: 'acme/2', pane: 'abcd1234~w2:p1' })
    expect(calls).toEqual([])
  })

  it('no board yet: no tasks, and nothing wrong', async () => {
    T.setInContainer(true)
    const r = await read()
    expect(r.machines[0]).toMatchObject({ status: 'ready', tasks: [], readOnly: true })
    expect(r.machines[0]!.error).toBeUndefined()
  })

  it('a folder it may not read: the error, and the last tasks kept, dated and marked', async () => {
    T.setInContainer(true)
    taskFile('acme/1', { title: 'Review me', stage: 'approval', app: 'claude' })
    const good = await read()
    later()
    fault = 'eacces'
    const r = await read()
    expect(r.machines[0]).toMatchObject({ error: 'EACCES: permission denied', stale: true, at: good.machines[0]!.at })
    expect(r.machines[0]!.tasks.map(t => t.id)).toEqual(['acme/1'])
  })

  it('a task file that is not JSON: said, the others read, its last row kept', async () => {
    T.setInContainer(true)
    taskFile('acme/1', { title: 'Review me', stage: 'approval', app: 'claude' })
    taskFile('acme/2', { title: 'To do', stage: 'todo' })
    await read()
    later()
    writeFileSync(path.join(home, '.herdr-projects/data/tasks/acme/2/task.json'), '{ broken')
    taskFile('acme/1', { title: 'Review me', stage: 'done' })
    const r = await read()
    expect(r.machines[0]!.error).toMatch(/^Some tasks could not be read: acme\/2 \(/)
    expect(Object.fromEntries(r.machines[0]!.tasks.map(t => [t.id, t.group]))).toEqual({ 'acme/1': 'done', 'acme/2': 'todo' })
    // Its details say so too, rather than an empty task.
    await expect(T.taskDetails('', 'acme/2')).rejects.toThrow()
  })

  it('a task file that is not JSON, before any good read: said, not an empty board', async () => {
    T.setInContainer(true)
    taskFile('acme/2', { title: 'To do', stage: 'todo' })
    writeFileSync(path.join(home, '.herdr-projects/data/tasks/acme/2/task.json'), '{ broken')
    const r = await read()
    expect(r.machines[0]!.error).toMatch(/acme\/2/)
  })

  it('refuses the actions, which belong to the host', async () => {
    T.setInContainer(true)
    await read()
    await expect(T.tellCoordinator('', 'hello')).rejects.toThrow(/container/)
    await expect(T.tellTask('', 'acme/2', 'hello')).rejects.toThrow(/container/)
    expect(calls).toEqual([])
  })
})

describe('actions on a task', () => {
  it('puts the user\'s words after --, so they are never read as flags', async () => {
    await read()
    await T.tellTask('', 'demo/3', '--delegate now')
    await T.tellCoordinator('', '--now please')
    expect(calls.slice(1)).toEqual([['tell', '--', 'demo/3', '--delegate now'], ['coordinator', '--', 'tell', '--now please']])
  })

  it('a named session reaches its machine\'s board, in the same queue', async () => {
    await read()
    await T.tellTask(session.key, 'demo/3', 'from the review session')
    expect(calls.at(-1)).toEqual(['tell', '--', 'demo/3', 'from the review session'])
  })

  it('refuses what the task cannot take, before running anything', async () => {
    await read()
    calls = []
    await expect(T.tellTask('', 'demo/4', 'hi')).rejects.toThrow(/no agent/)
    await expect(T.approveTask('', 'demo/2')).rejects.toThrow(/does not wait/)
    await expect(T.tellTask('', '../x', 'hi')).rejects.toThrow(/Invalid task/)
    await expect(T.tellTask('', 'demo/2', 'hi')).rejects.toThrow(/no agent/)
    await expect(T.tellTask('', 'demo/3', '   ')).rejects.toThrow(/Nothing to send/)
    expect(calls).toEqual([])
  })

  it('gives the first line of a refusal', async () => {
    await read()
    await expect(T.approveTask('', 'demo/1')).rejects.toThrow('demo/1: its pull request\'s checks failed')
  })

  it('never offers the pane of another session: a task linked to a session wherdr has not opened', async () => {
    // Its file names the "other" session; w1:p1 there is not the w1:p1 of the default session.
    taskFile('demo/1', { title: 'Fix login redirect', stage: 'approval', link: { socket: '/h/.config/herdr/sessions/other/herdr.sock', pane: 'w1:p1' } })
    panes.push({ id: 'w1:p1', machine: '', agent: 'claude', cwd: '/elsewhere' })
    expect((await T.taskDetails('', 'demo/1')).pane).toBeNull()
    T.setInContainer(true)
    expect((await T.taskDetails('', 'demo/1')).pane).toBeNull()
  })

  it('a link without a socket: the machine\'s own session, as herdr-projects reads it', async () => {
    taskFile('demo/1', { title: 'Fix login redirect', stage: 'approval', link: { pane: 'w1:p1' } })
    panes.push({ id: 'w1:p1', machine: '', agent: 'claude' })
    expect((await T.taskDetails('', 'demo/1')).pane).toBe('w1:p1')
  })

  it('the pane of the session the task names, when wherdr has it open', async () => {
    taskFile('demo/1', { title: 'Fix login redirect', stage: 'approval', link: { socket: '/h/.config/herdr/sessions/review/herdr.sock', pane: 'w1:p1' } })
    panes.push({ id: 'w1:p1', machine: '', agent: 'claude' }, { id: 'abcd1234~w1:p1', machine: 'abcd1234', agent: 'claude' })
    expect((await T.taskDetails('', 'demo/1')).pane).toBe('abcd1234~w1:p1')
  })

  it('finds the agent\'s pane by its worktree when the task file is elsewhere', async () => {
    panes.push({ id: 'w5:p1', machine: '', agent: 'codex', cwd: '/home/user/code/demo-wt/1' })
    const d = await T.taskDetails('', 'demo/1')
    expect(d).toMatchObject({ id: 'demo/1', pane: 'w5:p1' })
    expect(calls.at(-1)).toEqual(['details', '--json', '--', 'demo/1'])
  })

  it('runs one command at a time on a machine, whichever session asks', async () => {
    delay = 20
    vi.useRealTimers()
    await Promise.all([T.taskDetails('', 'demo/1'), T.tellCoordinator(session.key, 'a'), T.tellCoordinator('', 'b')])
    expect(maxActive).toBe(1)
  })
})

describe('the session on an SSH machine', () => {
  // The script as the remote shell runs it, with a launcher that says what it gets.
  const env = (name: string, extra: Record<string, string> = {}) => execFileSync('sh', ['-c', T.REMOTE_TASKS_SCRIPT, 'sh', '/opt/herdr', name, 'sh', '-c',
    'printf "%s|%s|%s|%s" "$HERDR_BIN_PATH" "${HERDR_SESSION-unset}" "${HERDR_SOCKET_PATH-unset}" "$1"', 'x', '--keep a'],
  { encoding: 'utf8', env: { PATH: process.env.PATH, ...extra } })

  it('names the machine\'s own session, and never a forwarded socket', () => {
    expect(env('review', { HERDR_SOCKET_PATH: '/tmp/forwarded.sock' })).toBe('/opt/herdr|review|unset|--keep a')
  })
  it('the default session: none named', () => {
    expect(env('default', { HERDR_SESSION: 'stale' })).toBe('/opt/herdr|unset|unset|--keep a')
    expect(env('')).toBe('/opt/herdr|unset|unset|--keep a')
  })
})
