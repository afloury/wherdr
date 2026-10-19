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
const panes: { id: string, machine?: string, agent?: string, cwd?: string, status?: string, name?: string }[] = []
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
vi.mock('../server/utils/env', () => ({ HERDR_BIN: 'herdr', HERDR_CHILD_ENV: {}, IN_CONTAINER: false, log: () => {} }))

const T = await import('../server/utils/projectsTasks')

let calls: string[][]
// `show --repo` (a repo's key): kept apart, so `calls` stays the Board's own commands.
let shows: string[][] = []
let keysOf: Record<string, string> = {}
let active = 0
let maxActive = 0
let delay = 0
let listReply: { code: number, stdout: string, stderr: string } | null = null
// `coordinator [--machine | --project=R] status --json`, by its flag ('' for the Coordinator).
let coordStatus: Record<string, { state: string, pane: string }> = {}
let clock = Date.now()
const later = (ms = 60_000) => { clock += ms; vi.setSystemTime(clock) }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  later()
  calls = []
  shows = []
  keysOf = { demo: 'DEMO' }
  active = maxActive = 0
  delay = 0
  listReply = null
  coordStatus = {}
  infoFails = false
  info.status = 'ready'
  panes.length = 0
  T.setInContainer(false)
  T.resetTasksCache()
  fault = ''
  rmSync(path.join(home, '.herdr-projects'), { recursive: true, force: true })
  T.setRunner(async (_m, launcher, args) => {
    expect(launcher).toBe('/plugins/herdr-projects/bin/run.sh')
    if (args[0] === 'show') {
      shows.push(args)
      const repo = args[1]!.replace('--repo=', '')
      return { code: 0, stdout: JSON.stringify({ settings: [{ name: 'repo.key', value: keysOf[repo] ?? 'none', note: '' }], problems: [] }), stderr: '' }
    }
    calls.push(args)
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(r => setTimeout(r, delay))
    active--
    if (args[0] === 'list') return listReply || { code: 0, stdout: fixture('list.json'), stderr: '' }
    // A failed task's details say what failed (1.2.1 failure_of): demo/6 its agent, demo/7 its setup.
    if (args[0] === 'details' && (args[3] === 'demo/6' || args[3] === 'demo/7')) {
      return { code: 0, stdout: JSON.stringify({ task: { id: args[3], title: 'Broke', stage: 'failed' }, failure: { stage: args[3] === 'demo/6' ? 'agent' : 'setup', title: 'Failed', detail: 'x', auth: false } }), stderr: '' }
    }
    if (args[0] === 'details') return { code: 0, stdout: fixture('details-approval.json'), stderr: '' }
    if (args[0] === 'coordinator' && args.at(-1) === 'status') {
      const flag = args.length > 3 ? args[1]! : ''
      return { code: 0, stdout: JSON.stringify({ name: 'x', agent: 'claude', ...(coordStatus[flag] || { state: 'none', pane: '' }) }), stderr: '' }
    }
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

  it('the same tasks read again are the same version: the poll gets { same: true }', async () => {
    T.setInContainer(true)
    taskFile('acme/1', { title: 'Review me', stage: 'approval', app: 'claude' })
    const first = await read()
    later(T.REUSE_MS + 2000)
    expect(await T.readTasksBoard(first.version)).toEqual({ same: true, version: first.version })
    taskFile('acme/1', { title: 'Review me', stage: 'done', app: 'claude' })
    later(T.REUSE_MS + 2000)
    expect(await T.readTasksBoard(first.version)).not.toHaveProperty('same')
  })

  it('a partial read marks only the rows it kept, each with its own read time', async () => {
    T.setInContainer(true)
    taskFile('acme/1', { title: 'Fine', stage: 'todo' })
    taskFile('acme/2', { title: 'Will break', stage: 'todo' })
    const first = await read()
    const firstAt = first.machines[0]!.at
    later()
    writeFileSync(path.join(home, '.herdr-projects/data/tasks/acme/2/task.json'), '{ broken')
    const r = await read()
    const m = r.machines[0]! as Board['machines'][0] & { tasks: { id: string, stale?: boolean, readAt?: number }[] }
    expect(m.stale).toBeFalsy()
    expect(m.at).toBe(clock)
    expect(m.tasks.find(t => t.id === 'acme/1')).not.toHaveProperty('stale')
    expect(m.tasks.find(t => t.id === 'acme/2')).toMatchObject({ stale: true, readAt: firstAt })
  })

  it('archived tasks never push live ones out of the rows shown', async () => {
    T.setInContainer(true)
    for (let n = 1000; n < 1600; n++) taskFile(`acme/${n}`, { title: `Old ${n}`, stage: 'done', archivedAt: 1 })
    for (const n of [1, 2, 3]) taskFile(`acme/${n}`, { title: `Live ${n}`, stage: 'todo' })
    const r = await read()
    expect(r.machines[0]!.tasks.map(t => t.id).sort()).toEqual(['acme/1', 'acme/2', 'acme/3'])
  })

  it('details name the program on the task, from `app` when that is all the file has', async () => {
    T.setInContainer(true)
    taskFile('acme/1', { title: 'Review me', stage: 'approval', app: 'claude' })
    expect(await T.taskDetails('', 'acme/1')).toMatchObject({ agent: 'claude' })
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

  it('no task file: no pane, even with a single agent in its worktree in the board\'s session', async () => {
    panes.push({ id: 'w5:p1', machine: '', agent: 'codex', cwd: '/home/user/code/demo-wt/1' })
    const d = await T.taskDetails('', 'demo/1')
    expect(d).toMatchObject({ id: 'demo/1', pane: null })
    expect(calls.at(-1)).toEqual(['details', '--json', '--', 'demo/1'])
  })

  it('an unreadable task file: no pane, even with a single agent in its worktree', async () => {
    taskFile('demo/1', {})
    writeFileSync(path.join(home, '.herdr-projects/data/tasks/demo/1/task.json'), '{ "link": { "pane": "w2:')
    panes.push({ id: 'w9:p1', machine: '', agent: 'codex', cwd: '/home/user/code/demo-wt/1' })
    expect((await T.taskDetails('', 'demo/1')).pane).toBeNull()
  })

  it('a task file without a link: no pane, even with a single agent in its worktree', async () => {
    taskFile('demo/1', { title: 'Fix login redirect', stage: 'approval' })
    panes.push({ id: 'w9:p1', machine: '', agent: 'codex', cwd: '/home/user/code/demo-wt/1' })
    expect((await T.taskDetails('', 'demo/1')).pane).toBeNull()
    taskFile('demo/1', { title: 'Fix login redirect', stage: 'approval', link: null })
    expect((await T.taskDetails('', 'demo/1')).pane).toBeNull()
  })

  it('a link that is not a pane id: no pane, even with a single agent in its worktree', async () => {
    taskFile('demo/1', { title: 'Fix login redirect', stage: 'approval', link: { pane: 'not a pane' } })
    panes.push({ id: 'w9:p1', machine: '', agent: 'codex', cwd: '/home/user/code/demo-wt/1' })
    expect((await T.taskDetails('', 'demo/1')).pane).toBeNull()
  })

  it('a linked pane that is gone gives no pane, never another agent in the same worktree', async () => {
    taskFile('demo/1', { title: 'Fix login redirect', stage: 'approval', link: { pane: 'w2:p1' } })
    // An unrelated agent, in another session, on the same folder.
    panes.push({ id: 'abcd1234~w8:p1', machine: 'abcd1234', agent: 'claude', cwd: '/home/user/code/demo-wt/1' })
    panes.push({ id: 'w9:p1', machine: '', agent: 'codex', cwd: '/home/user/code/demo-wt/1' })
    expect((await T.taskDetails('', 'demo/1')).pane).toBeNull()
  })

  it('the closing note comes from the task file, which 1.2.1 details leave it out of', async () => {
    taskFile('demo/1', { title: 'Fix login redirect', stage: 'approval', summary: 'Redirect fixed, two tests added.' })
    expect((await T.taskDetails('', 'demo/1')).summary).toBe('Redirect fixed, two tests added.')
  })

  it('runs one command at a time on a machine, whichever session asks', async () => {
    delay = 20
    vi.useRealTimers()
    await Promise.all([T.taskDetails('', 'demo/1'), T.tellCoordinator(session.key, 'a'), T.tellCoordinator('', 'b')])
    expect(maxActive).toBe(1)
  })
})

describe('the user\'s PATH for herdr-projects on this machine', () => {
  it('finds the agents in user folders, even from a login service\'s short PATH', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-launcher-'))
    try {
      mkdirSync(path.join(home, '.local/bin'), { recursive: true })
      mkdirSync(path.join(home, 'pd'), { recursive: true })
      writeFileSync(path.join(home, 'pd/env.json'), JSON.stringify({ PATH: '/login/only/bin' }))
      const env = T.launcherEnv(home, '/tmp/h.sock', { HERDR_PROJECTS_DATA_DIR: path.join(home, 'pd') })
      const dirs = String(env.PATH).split(':')
      expect(dirs).toContain(path.join(home, '.local/bin'))
      expect(dirs).toContain('/login/only/bin')
      expect(env).toMatchObject({ HERDR_BIN_PATH: 'herdr', NO_COLOR: '1', HERDR_SOCKET_PATH: '/tmp/h.sock' })
    } finally { rmSync(home, { recursive: true, force: true }) }
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
  it('completes the remote PATH first, as on this machine (not a login shell there)', async () => {
    const { USER_PATH_SH } = await import('../bin/lib/userpath.mjs')
    expect(T.REMOTE_TASKS_SCRIPT.startsWith(USER_PATH_SH)).toBe(true)
    const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-remote-'))
    try {
      mkdirSync(path.join(home, '.cargo/bin'), { recursive: true })
      const out = execFileSync('sh', ['-c', T.REMOTE_TASKS_SCRIPT, 'sh', '/opt/herdr', '', 'sh', '-c', 'printf %s "$PATH"'],
        { encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin' } })
      expect(out.split(':')).toContain(path.join(home, '.cargo/bin'))
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
  it('the default session: none named', () => {
    expect(env('default', { HERDR_SESSION: 'stale' })).toBe('/opt/herdr|unset|unset|--keep a')
    expect(env('')).toBe('/opt/herdr|unset|unset|--keep a')
  })
})

describe('an agent in a user folder, from an SSH command', () => {
  it('is found by herdr-projects, and the arguments reach the launcher as they were', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-remote-'))
    try {
      const claude = path.join(home, '.local/bin/claude')
      mkdirSync(path.dirname(claude), { recursive: true })
      writeFileSync(claude, '#!/bin/sh\necho "2.1.0 (Claude Code)"\n', { mode: 0o755 })
      // sshd's default PATH, without the user's own folders.
      const run = (session: string, cmd: string, ...args: string[]) => execFileSync('/bin/sh', ['-c', T.REMOTE_TASKS_SCRIPT, 'sh', '/opt/herdr', session, '/bin/sh', '-c', cmd, 'x', ...args],
        { encoding: 'utf8', env: { HOME: home, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' } })
      expect(run('', 'command -v claude && claude --version')).toBe(`${claude}\n2.1.0 (Claude Code)\n`)
      expect(run('review', 'printf "%s|%s|%s" "$HERDR_BIN_PATH" "$HERDR_SESSION" "$1"', '$(id) --keep a')).toBe('/opt/herdr|review|$(id) --keep a')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})

describe('task keys', () => {
  it('names a task by its repo\'s key, asked once per repo with show --repo, and again after a while', async () => {
    keysOf = { demo: 'APP' }
    await read()
    await vi.waitFor(() => expect(shows).toEqual([['show', '--repo=demo', '--json']]))
    T.resetTasksCache(true)
    const r = await read()
    expect(r.machines[0]!.tasks.every(t => (t as { repoKey?: string }).repoKey === 'APP')).toBe(true)
    // Read again: the key is not asked again.
    T.resetTasksCache(true)
    await read()
    expect(shows).toHaveLength(1)
    expect(T.repoKeyOf('', 'demo')).toBe('APP')
  })
})

describe('start, stop, retry, archive, add, and the three coordinators', () => {
  // A board with a task of each kind these act on.
  const board = JSON.stringify([
    { id: 'demo/5', state: 'idle', title: 'In the backlog', stage: 'todo' },
    { id: 'demo/6', state: 'error', app: 'claude', title: 'Broke', stage: 'failed' },
    { id: 'demo/7', state: 'error', app: 'claude', title: 'Setup broke', stage: 'failed' },
    { id: 'demo/3', state: 'working', app: 'codex', title: 'Add dark mode toggle', stage: 'working' },
    { id: 'demo/4', state: 'done', title: 'Old cleanup', stage: 'done' },
  ])
  beforeEach(() => { listReply = { code: 0, stdout: board, stderr: '' } })

  it('runs each command with the task\'s id after --', async () => {
    await read()
    await T.taskCommand('', 'demo/5', 'delegate')
    await read()
    await T.taskCommand('', 'demo/3', 'stop')
    await read()
    await T.taskCommand('', 'demo/6', 'retry')
    await read()
    await T.taskCommand('', 'demo/4', 'archive')
    expect(calls.filter(c => c[0] !== 'list')).toEqual([['delegate', '--', 'demo/5'], ['stop', '--', 'demo/3'], ['details', '--json', '--', 'demo/6'], ['retry', '--', 'demo/6'], ['archive', '--', 'demo/4']])
  })

  it('a failed task: what failed (details) decides between Retry and Start, as 1.2.1 send_error does', async () => {
    await read()
    calls = []
    // Its setup failed, no agent ever on it: retry is refused, Start runs.
    await expect(T.taskCommand('', 'demo/7', 'retry')).rejects.toThrow(/nothing to retry/)
    await T.taskCommand('', 'demo/7', 'delegate')
    // Its agent failed: Start is refused, Retry is not.
    await read()
    await expect(T.taskCommand('', 'demo/6', 'delegate')).rejects.toThrow(/cannot be started/)
    expect(calls.filter(c => c[0] !== 'list' && c[0] !== 'details')).toEqual([['delegate', '--', 'demo/7']])
  })

  it('right after another action (the list dropped): reads the list again, then acts', async () => {
    await read()
    await T.addTask('', { title: 'New one' })
    calls = []
    await T.taskCommand('', 'demo/5', 'delegate')
    expect(calls).toEqual([['list', '--json'], ['delegate', '--', 'demo/5']])
  })

  it('refuses what does not apply to the task, or an unknown command, before running anything', async () => {
    await read()
    calls = []
    await expect(T.taskCommand('', 'demo/3', 'delegate')).rejects.toThrow(/cannot be started/)
    await expect(T.taskCommand('', 'demo/5', 'stop')).rejects.toThrow(/no agent at work to stop/)
    await expect(T.taskCommand('', 'demo/3', 'archive')).rejects.toThrow(/cannot be archived/)
    await expect(T.taskCommand('', 'demo/4', 'retry')).rejects.toThrow(/nothing to retry/)
    await expect(T.taskCommand('', 'demo/5', 'clear')).rejects.toThrow(/Unknown action/)
    await expect(T.taskCommand('', 'demo/99', 'archive')).rejects.toThrow(/cannot be archived/)
    expect(calls).toEqual([])
  })

  it('adds a task: flags as --flag=value, the title after --; a bad repo runs nothing', async () => {
    await T.addTask('', { title: '  --fix\nthe login ', description: '--desc trick', repo: 'wherdr', delegate: true })
    await T.addTask('', { title: 'In the home folder' })
    await T.addTask('', { title: 'By its folder', repo: '~/code/app' })
    expect(calls).toEqual([
      ['add', '--desc=--desc trick', '--repo=wherdr', '--delegate', '--', '--fix the login'],
      ['add', '--', 'In the home folder'],
      ['add', '--repo=~/code/app', '--', 'By its folder'],
    ])
    calls = []
    await expect(T.addTask('', { title: 'x', repo: '--all' })).rejects.toThrow(/Invalid repo/)
    await expect(T.addTask('', { title: '   ' })).rejects.toThrow(/title/)
    expect(calls).toEqual([])
  })

  it('talks to the Coordinator, the machine coordinator or a project coordinator, with Send and start', async () => {
    await T.tellCoordinator('', 'plain')
    await T.tellCoordinator('', 'and start', { delegate: true })
    await T.tellCoordinator('', 'machine', { to: { kind: 'machine' } })
    await T.tellCoordinator('', '--repo', { to: { kind: 'project', repo: 'wherdr' }, delegate: true })
    expect(calls).toEqual([
      ['coordinator', '--', 'tell', 'plain'],
      ['coordinator', '--delegate', '--', 'tell', 'and start'],
      ['coordinator', '--machine', '--', 'tell', 'machine'],
      ['coordinator', '--project=wherdr', '--delegate', '--', 'tell', '--repo'],
    ])
    calls = []
    await expect(T.tellCoordinator('', 'x', { to: { kind: 'project', repo: '../etc' } })).rejects.toThrow(/Invalid coordinator/)
    expect(calls).toEqual([])
  })

  it('a coordinator\'s pane is the one herdr-projects keeps for it, never one found by name', async () => {
    // Two repos whose agents' names Herdr would mix up (demo, demo-2): each has its own pane.
    coordStatus = { '--project=demo': { state: 'idle', pane: 'w2:p1' }, '--project=demo-2': { state: 'working', pane: 'w1:p1' }, '': { state: 'blocked', pane: 'w3:p1' } }
    panes.push({ id: 'w1:p1', machine: '', name: 'sw-coordinator-demo' }, { id: 'w2:p1', machine: '', name: 'sw-coordinator-demo-2' }, { id: 'w3:p1', machine: '', name: 'sw-coordinator' })
    // The same pane id and name in the machine's named session: not the board's.
    panes.unshift({ id: 'abcd1234~w2:p1', machine: 'abcd1234', name: 'sw-coordinator-demo' })
    expect(await T.coordinatorPane('', { kind: 'project', repo: 'demo' })).toEqual({ pane: 'w2:p1', state: 'idle' })
    expect(await T.coordinatorPane('', { kind: 'project', repo: 'demo-2' })).toEqual({ pane: 'w1:p1', state: 'working' })
    expect(await T.coordinatorPane('', { kind: 'main' })).toEqual({ pane: 'w3:p1', state: 'blocked' })
    // Not started: no pane, even with one named like it.
    expect(await T.coordinatorPane('', { kind: 'machine' })).toEqual({ pane: null, state: 'none' })
    // Exited, or a pane Herdr does not show (any more): none either.
    coordStatus = { '--project=demo': { state: 'exited', pane: 'w2:p1' }, '--project=web': { state: 'idle', pane: 'w9:p1' } }
    expect((await T.coordinatorPane('', { kind: 'project', repo: 'demo' })).pane).toBeNull()
    expect((await T.coordinatorPane('', { kind: 'project', repo: 'web' })).pane).toBeNull()
    // Asked of the board's own session, the user's words never as a flag.
    expect(calls.filter(c => c[0] === 'coordinator')).toEqual([
      ['coordinator', '--project=demo', '--json', 'status'], ['coordinator', '--project=demo-2', '--json', 'status'],
      ['coordinator', '--json', 'status'], ['coordinator', '--machine', '--json', 'status'],
      ['coordinator', '--project=demo', '--json', 'status'], ['coordinator', '--project=web', '--json', 'status'],
    ])
    await expect(T.coordinatorPane('', { kind: 'project', repo: '--all' })).rejects.toThrow(/Invalid coordinator/)
    // From a container: nothing asked, no pane.
    calls = []
    T.setInContainer(true)
    expect(await T.coordinatorPane('', { kind: 'main' })).toEqual({ pane: null, state: 'unknown' })
    expect(calls).toEqual([])
  })

  it('from a container: none of them runs', async () => {
    T.setInContainer(true)
    await expect(T.addTask('', { title: 'x' })).rejects.toThrow(/container/)
    await expect(T.taskCommand('', 'demo/5', 'delegate')).rejects.toThrow()
    await expect(T.tellCoordinator('', 'x', { to: { kind: 'machine' } })).rejects.toThrow(/container/)
    expect(calls).toEqual([])
  })
})
