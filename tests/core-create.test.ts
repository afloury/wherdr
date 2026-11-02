import { describe, expect, it } from 'vitest'
import { CoreError } from '../server/utils/core'
import { coreAddMachine, coreCreate, coreIsGit, coreListDirs, type CoreAdminDeps } from '../server/utils/coreCreate'
import type { MachineInfo, Pane, Workspace } from '../shared/types'

const b64 = (s: string) => Buffer.from(s).toString('base64')
const machines: MachineInfo[] = [
  { key: '', label: 'Local', local: true, status: 'online', error: null },
  { key: '7667', label: 'vps', local: false, status: 'online', error: null },
  { key: '6f66', label: 'off', local: false, status: 'offline', error: null },
]
let workspaces: Workspace[] = []
function setup(reply: (method: string, params: any) => unknown = () => ({})) {
  const calls: [string, any][] = []
  const deps: CoreAdminDeps = {
    call: async (method, params) => {
      calls.push([method, params])
      const r = method === 'machine.exec' ? execReply(params) : reply(method, params)
      if (r instanceof Error) throw r
      return r as never
    },
    machines: () => machines,
    panes: () => [{ id: 'w1:p1', workspace: 'w1', coreAddress: 'vps/t7' } as Pane, { id: 'w2:p2', workspace: 'w2', coreAddress: 't3' } as Pane],
    workspaces: () => workspaces,
    settle: async () => {},
    recent: async () => [],
    remember: async () => {},
  }
  const execReply = (params: any) => {
    const script: string = params.argv[2]
    if (script.includes('$HOME"') && script.startsWith('printf')) return { code: 0, stdout: b64('/home/u') }
    if (script.startsWith('test -d')) return { code: params.argv[4] === '/home/u/missing' ? 1 : 0, stdout: '' }
    if (script.startsWith('test -e')) return { code: 0, stdout: '' }
    if (script.includes('command -v')) return { code: 0, stdout: b64('claude\ncodex\n') }
    return { code: 0, stdout: b64('g api\nd docs\n') }
  }
  return { deps, calls, runs: () => calls.filter(c => c[0] === 'terminal.run') }
}

describe('core creation', () => {
  it('labels a new terminal for herdr-app: a new tab of the space holding the folder', async () => {
    workspaces = [{ id: 'ws1', label: 'App', coreSpace: 'spapp', path: '/home/u/app', number: 1, status: null, worktree: false },
      { id: 'ws2', label: 'x', path: '/home/u/app/deep', number: 2, status: null, worktree: false }]
    const t = setup(() => ({ address: 't3' }))
    await coreCreate(t.deps, { kind: 'shell', cwd: '/home/u/app/src' })
    const l = t.runs()[0]![1].labels
    expect(l['herdr.space']).toBe('spapp')
    expect(l['herdr.tab']).toMatch(/^tb[0-9a-f]{32}$/)
    expect(l['herdr.seen']).toBe('0')
  })
  it('puts a "new tab" in the space it was asked for, and in a new space when no folder matches', async () => {
    workspaces = [{ id: 'ws1', label: 'App', coreSpace: 'spapp', path: '/elsewhere', number: 1, status: null, worktree: false },
      { id: 'ws2', label: 'Dir', path: '/home/u', number: 2, status: null, worktree: false }]
    let t = setup(() => ({ address: 't3' }))
    await coreCreate(t.deps, { kind: 'shell', cwd: '/home/u', workspace: 'ws1' })
    expect(t.runs()[0]![1].labels['herdr.space']).toBe('spapp')
    t = setup(() => ({ address: 't3' }))
    await coreCreate(t.deps, { kind: 'shell', cwd: '/home/u' })
    expect(t.runs()[0]![1].labels['herdr.space']).toMatch(/^sp[0-9a-f]{32}$/)
    // A folder-grouped workspace: no herdr label, the terminal stays beside the others.
    t = setup(() => ({ address: 't3' }))
    await coreCreate(t.deps, { kind: 'shell', cwd: '/home/u', workspace: 'ws2' })
    expect(Object.keys(t.runs()[0]![1].labels)).toEqual(['wherdr-request'])
  })

  it('runs a terminal without parent, with a correlation label, on a machine', async () => {
    const t = setup(() => ({ address: 'vps/t7' }))
    const r = await coreCreate(t.deps, { kind: 'shell', machine: '7667', cwd: '/home/u/app', name: 'My Shell' })
    const p = t.runs()[0]![1]
    expect(p).toMatchObject({ cwd: '/home/u/app', on: 'vps', name: 'my-shell', no_parent: true, wait: false })
    expect(p.line).toBeUndefined()
    expect(p.labels['wherdr-request']).toMatch(/^[0-9a-f]{16}$/)
    expect(r).toMatchObject({ pane_id: 'w1:p1', workspace_id: 'w1', name: null })
  })
  it('starts an installed agent CLI through the machine shell, not an uninstalled one', async () => {
    const t = setup(() => ({ address: 't3' }))
    expect(await coreCreate(t.deps, { kind: 'claude', cwd: '/home/u' })).toMatchObject({ pane_id: 'w2:p2', name: 'claude' })
    expect(t.runs()[0]![1].line).toMatch(/exec claude$/)
    expect(t.runs()[0]![1].on).toBeUndefined()
    await expect(coreCreate(t.deps, { kind: 'gemini', cwd: '/home/u' })).rejects.toMatchObject({ code: 'not_installed' })
    expect(t.runs()).toHaveLength(1)
  })
  it('refuses a bad kind, offline machine, outside or missing folder before running anything', async () => {
    const t = setup()
    await expect(coreCreate(t.deps, { kind: 'rm -rf' })).rejects.toMatchObject({ code: 'bad_kind' })
    await expect(coreCreate(t.deps, { kind: 'shell', machine: '6f66' })).rejects.toMatchObject({ code: 'unreachable' })
    await expect(coreCreate(t.deps, { kind: 'shell', machine: 'zz' })).rejects.toMatchObject({ code: 'bad_machine' })
    await expect(coreCreate(t.deps, { kind: 'shell', cwd: '/etc' })).rejects.toMatchObject({ code: 'bad_cwd' })
    await expect(coreCreate(t.deps, { kind: 'shell', cwd: '/home/u/missing' })).rejects.toMatchObject({ code: 'bad_cwd' })
    expect(t.runs()).toHaveLength(0)
  })
  it('reconciles a lost answer by label and never runs twice', async () => {
    let label = ''
    const t = setup((method, params) => {
      if (method === 'terminal.run') { label = params.labels['wherdr-request']; return new CoreError('timeout', 'x') }
      return { terminals: [{ address: 't3', labels: { 'wherdr-request': label } }] }
    })
    expect(await coreCreate(t.deps, { kind: 'shell', cwd: '/home/u' })).toMatchObject({ pane_id: 'w2:p2' })
    expect(t.runs()).toHaveLength(1)
    const lost = setup((method) => method === 'terminal.run' ? new CoreError('timeout', 'x') : { terminals: [] })
    await expect(coreCreate(lost.deps, { kind: 'shell', cwd: '/home/u' })).rejects.toMatchObject({ code: 'uncertain' })
    expect(lost.runs()).toHaveLength(1)
  })
  it('maps core refusals', async () => {
    const t = setup(() => new CoreError('name_taken', 'x'))
    await expect(coreCreate(t.deps, { kind: 'shell', cwd: '/home/u', name: 'a' })).rejects.toMatchObject({ code: 'name_taken' })
  })
  it('lists and checks folders through machine.exec, under home only', async () => {
    const t = setup()
    const l = await coreListDirs(t.deps, null, '7667')
    expect(l).toMatchObject({ path: '/home/u', home: '/home/u', parent: null })
    expect(l.dirs.map(d => d.name)).toEqual(['api', 'docs'])
    expect(t.calls.find(c => c[0] === 'machine.exec' && c[1].on)).toBeTruthy()
    await expect(coreListDirs(t.deps, '/etc', '')).rejects.toMatchObject({ code: 'bad_path' })
    expect(await coreIsGit(t.deps, '/home/u/api', '')).toEqual({ git: true })
    expect(await coreIsGit(t.deps, '/etc', '')).toEqual({ git: false })
  })
  it('adds a machine by SSH target only, never as an option', async () => {
    const t = setup()
    await coreAddMachine(t.deps, { target: 'me@10.0.0.7:2222', name: 'box' })
    expect(t.calls.at(-1)).toEqual(['machine.add', { target: 'me@10.0.0.7:2222', name: 'box' }])
    for (const target of ['-oProxyCommand=x', '', 'a b', 'x;y']) await expect(coreAddMachine(t.deps, { target })).rejects.toMatchObject({ code: 'bad_target' })
    await expect(coreAddMachine(t.deps, { target: 'x', name: 'Bad Name' })).rejects.toMatchObject({ code: 'bad_name' })
    const taken = setup(() => new CoreError('already_added', 'x'))
    await expect(coreAddMachine(taken.deps, { target: 'vps' })).rejects.toMatchObject({ code: 'already_added' })
  })
})
