// WHR-404: `wherdr alfred`, Alfred's own command: parsing, the dry run shown
// before a change, the server's run with its token from Alfred's home, the
// route (this machine only) and the guard's token exemption.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dryRun, parseAlfredCommand } from '../shared/pm/alfredCli'
import { runAlfredCommand } from '../server/utils/alfredCli'
import { ALFRED_TOKEN_FILE, answerProposal, issueAlfredToken } from '../server/utils/pmCoordinator'
import { MAIN } from '../shared/pm/coordinator'
import { createPmStore } from '../server/utils/pmStore'
import { cliTokenCall } from '../server/utils/network'
import { common } from '../shared/pm/examples'
import type { CoreAdminDeps } from '../server/utils/coreCreate'

describe('parseAlfredCommand', () => {
  it('reads the read-only commands', () => {
    expect(parseAlfredCommand(['projects'])).toEqual({ name: 'projects' })
    expect(parseAlfredCommand(['project', 'web'])).toEqual({ name: 'project', key: 'WEB' })
    expect(parseAlfredCommand(['coordinator', 'open', 'WEB'])).toEqual({ name: 'coordinator open', key: 'WEB' })
    expect(parseAlfredCommand(['settings', 'x'])).toMatchObject({ error: /^unknown command/ })
    expect(parseAlfredCommand(['projects', '--apply'])).toEqual({ error: '--apply is for a change only' })
  })

  it('reads the changes, a dry run unless --apply', () => {
    expect(parseAlfredCommand(['project', 'add', 'web', '--machine', '', '--path', '/src/web', '--template', 'common'])).toEqual({
      name: 'project add', apply: false, input: { key: 'WEB', machine: '', path: '/src/web', template: 'common' },
    })
    expect(parseAlfredCommand(['project', 'template', 'WEB', 'none', '--apply'])).toEqual({ name: 'project template', apply: true, key: 'WEB', template: '' })
    expect(parseAlfredCommand(['coordinator', 'start', 'WEB', '--program', 'codex'])).toEqual({ name: 'coordinator start', apply: false, key: 'WEB', program: 'codex' })
    expect(parseAlfredCommand(['setting', 'set', 'theme', 'catppuccin-latte', '--apply'])).toEqual({ name: 'setting set', apply: true, key: 'theme', value: 'catppuccin-latte' })
  })

  it('says what is wrong', () => {
    expect(parseAlfredCommand(['project', 'add', 'WEB', '--path', '/x'])).toEqual({ error: 'usage: wherdr alfred project add <KEY> --machine <key> --path <folder> [--name <name>] [--template <id>] [--apply]' })
    expect(parseAlfredCommand(['project', 'add', 'WEB', '--machine', '', '--path', '/x', '--force', 'y'])).toEqual({ error: 'unknown option --force' })
    expect(parseAlfredCommand(['coordinator', 'start', 'WEB', '--program', 'omp'])).toEqual({ error: '--program is claude or codex' })
    expect(parseAlfredCommand(['setting', 'set', 'password', 'x'])).toMatchObject({ error: /^password is not a setting Alfred changes/ })
    // Only a value the app reads: no theme "light", no list setting.
    expect(parseAlfredCommand(['setting', 'set', 'theme', 'light'])).toMatchObject({ error: /^light is not a value of theme: one of herdr, claude-code/ })
    expect(parseAlfredCommand(['setting', 'set', 'showQuotas', 'yes'])).toEqual({ error: 'yes is not a value of showQuotas: one of 1, 0' })
    expect(parseAlfredCommand(['setting', 'set', 'hiddenAgents', '[]'])).toMatchObject({ error: /^hiddenAgents is not a setting Alfred changes/ })
    expect(parseAlfredCommand(['project', 'remove', 'WEB'])).toMatchObject({ error: /^unknown command: project remove WEB/ })
    expect(parseAlfredCommand('projects')).toEqual({ error: 'argv must be a list of words' })
  })

  it('reads the workflow and delegation commands', () => {
    expect(parseAlfredCommand(['project', 'workflow', 'web', '--from', 'example:company'])).toEqual({ name: 'project workflow', apply: false, key: 'WEB', from: 'example:company' })
    expect(parseAlfredCommand(['project', 'workflow', 'edit', 'WEB'])).toEqual({ name: 'project workflow edit', key: 'WEB' })
    expect(parseAlfredCommand(['project', 'workflow', 'edit', 'WEB', '--apply'])).toEqual({ error: '--apply is for a change only' })
    expect(parseAlfredCommand(['project', 'workflow', 'WEB'])).toMatchObject({ error: /^usage: wherdr alfred project workflow <KEY> --from/ })
    expect(parseAlfredCommand(['tell', 'web', 'propose a workflow'])).toEqual({ name: 'tell', key: 'WEB', text: 'propose a workflow' })
    expect(parseAlfredCommand(['tell', 'WEB'])).toMatchObject({ error: /^usage: wherdr alfred tell/ })
    expect(parseAlfredCommand(['last', 'WEB'])).toEqual({ name: 'last', key: 'WEB' })
  })
})

describe('dryRun', () => {
  it('shows the change, the machine it reaches and the command that makes it', () => {
    expect(dryRun(['setting', 'set', 'theme', 'solar dark'], { change: ['setting theme: (default) → "solar dark"'], remote: 'mac' })).toEqual({
      dryRun: true,
      change: ['setting theme: (default) → "solar dark"'],
      remote: 'This reaches machine mac: make it only if the user asked for it',
      next: 'Show this to the user; only after their yes, run: wherdr alfred setting set theme \'solar dark\' --apply',
    })
  })
})

describe('runAlfredCommand', () => {
  let dir = '', store: ReturnType<typeof createPmStore>, token = ''
  const machines = [{ key: '', label: 'this', local: true, status: 'online' }, { key: 'mac', label: 'Mac', local: false, status: 'online' }]
  const checked: string[] = []
  let failCheck = false
  const deps = () => ({
    store, machines: () => machines, panes: () => [], urls: { local: 'http://127.0.0.1:7690' }, settingsFile: path.join(dir, 'settings.json'),
    check: async (m: string, f: string) => { if (failCheck) throw new Error('path: a folder inside the home folder'); checked.push(`${m}:${f}`); return f },
  }) as unknown as Parameters<typeof runAlfredCommand>[0]
  const run = (...argv: string[]) => runAlfredCommand(deps(), token, { argv })

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alfred-cli-'))
    store = createPmStore(path.join(dir, 'pm'))
    await store.setEnabled(true)
    await store.saveTemplate(common)
    await issueAlfredToken(store, dir)
    token = (await fs.readFile(path.join(dir, ALFRED_TOKEN_FILE), 'utf8')).trim()
    checked.length = 0
    failCheck = false
  })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  it('keeps its token in a private file of its home; another token is refused', async () => {
    expect((await fs.stat(path.join(dir, ALFRED_TOKEN_FILE))).mode & 0o777).toBe(0o600)
    await expect(runAlfredCommand(deps(), 'f'.repeat(64), { argv: ['projects'] })).rejects.toThrow('Unknown Alfred token')
    await issueAlfredToken(store, dir) // a new start: the old token stops working
    await expect(run('projects')).rejects.toThrow('Unknown Alfred token')
  })

  it('shows a change, then makes it with --apply only', async () => {
    // On another machine: nothing reached before the user's yes.
    const shown = await run('project', 'add', 'WEB', '--machine', 'Mac', '--path', '/src/web')
    expect(shown).toMatchObject({ dryRun: true, change: ['add project WEB "WEB"', 'folder /src/web on Mac (checked when applied: inside the home folder, a git repository, not already a project)', 'template none'], remote: expect.stringContaining('Mac') })
    expect(checked).toEqual([])
    expect(await store.projects()).toEqual([])
    expect(await run('project', 'add', 'WEB', '--machine', 'mac', '--path', '/src/web', '--apply')).toMatchObject({ applied: true, result: { key: 'WEB', machine: 'mac' } })
    expect(checked).toEqual(['mac:/src/web'])
    expect(await run('project', 'template', 'WEB', 'common')).toMatchObject({ dryRun: true, change: ['project WEB template: none → common'] })
    await run('project', 'template', 'WEB', 'common', '--apply')
    expect(await run('projects')).toMatchObject({ enabled: true, projects: [{ key: 'WEB', from: { template: 'common' }, machineName: 'Mac' }] })
    await expect(run('project', 'template', 'WEB', 'nope')).rejects.toThrow('No template nope')
  })

  it('shows the project\'s guards and changes them after its dry run', async () => {
    expect(parseAlfredCommand(['project', 'guards', 'WEB', '--merge-others', 'me'])).toEqual({ error: '--merge-protected and --merge-others are user or engine' })
    await run('project', 'add', 'WEB', '--machine', '', '--path', '/src/web', '--template', 'common', '--apply')
    expect(await run('project', 'guards', 'WEB')).toEqual({ project: 'WEB', guards: common.guards ?? {} })
    expect(await run('project', 'guards', 'WEB', '--protect', 'main,v3', '--merge-others', 'user')).toMatchObject({ dryRun: true })
    await run('project', 'guards', 'WEB', '--protect', 'main,v3', '--merge-others', 'user', '--apply')
    expect((await store.workflow('WEB'))!.guards).toMatchObject({ protected: ['main', 'v3'], merge: { others: 'user' } })
  })

  it('makes the folder checks of --apply in the dry run on this machine', async () => {
    expect(await run('project', 'add', 'APP', '--machine', '', '--path', '/src/app')).toMatchObject({ dryRun: true, change: ['add project APP "APP"', 'folder /src/app on this machine (checked: a git repository)', 'template none'] })
    expect(checked).toEqual([':/src/app'])
    await run('project', 'add', 'APP', '--machine', '', '--path', '/src/app', '--apply')
    await expect(run('project', 'add', 'APP2', '--machine', '', '--path', '/src/app')).rejects.toThrow('This folder is already a project')
    failCheck = true
    await expect(run('project', 'add', 'OUT', '--machine', '', '--path', '/opt/x')).rejects.toThrow('path: a folder inside the home folder')
  })

  it('changes a setting after its dry run', async () => {
    expect(await run('setting', 'set', 'theme', 'nord')).toMatchObject({ dryRun: true, change: ['setting theme: (default) → "nord"'] })
    expect(await run('settings')).toMatchObject({ settings: {}, values: { theme: expect.arrayContaining(['nord', 'catppuccin-latte']), showQuotas: ['1', '0'] } })
    await run('setting', 'set', 'theme', 'nord', '--apply')
    expect(await run('settings')).toMatchObject({ settings: { theme: 'nord' } })
    expect(await run('setting', 'set', 'theme', 'nord')).toEqual({ unchanged: true, theme: 'nord' })
    await expect(run('setting', 'set', 'theme', 'light', '--apply')).rejects.toThrow('light is not a value of theme')
  })

  it('starts a project coordinator with the user\'s first offered agent that can run it, no model', async () => {
    await run('project', 'add', 'WEB', '--machine', '', '--path', '/src/web', '--apply')
    expect(await run('coordinator', 'start', 'WEB')).toMatchObject({ dryRun: true, change: ['start the coordinator of WEB with claude on this machine'] })
    // Settings › Agents: OMP first (it cannot run a project coordinator), Claude unchecked.
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ v: 1, settings: { agentOrder: '["omp","claude","codex"]', hiddenAgents: '["claude"]' } }))
    expect(await run('coordinator', 'start', 'WEB')).toMatchObject({ change: ['start the coordinator of WEB with codex on this machine'] })
    expect(await run('coordinators')).toMatchObject({ coordinators: [{ project: '_main' }, { project: 'WEB', agent: 'codex' }] })
    expect(await run('coordinator', 'start', 'WEB', '--program', 'claude')).toMatchObject({ change: ['start the coordinator of WEB with claude on this machine'] })
    await expect(run('coordinator', 'start', 'WEB', '--program', 'codex', '--model', 'gpt-6')).rejects.toThrow()
  })
})

describe('Alfred and a project\'s workflow and coordinator', () => {
  let dir = '', store: ReturnType<typeof createPmStore>, token = ''
  const sent: unknown[] = []
  let panes: { id: string, coreAddress: string, status: string }[] = []
  const deps = () => ({
    store, machines: () => [{ key: '', label: 'this', local: true, status: 'online' }], panes: () => panes, urls: { local: 'http://127.0.0.1:7690' },
    settingsFile: path.join(dir, 'settings.json'), check: async (_m: string, f: string) => f, reply: async () => ({ text: 'Proposed: see the review' }),
    call: async (m: string, p: unknown) => { sent.push([m, p]); return {} },
  }) as unknown as Parameters<typeof runAlfredCommand>[0]
  const run = (argv: string[], input?: string) => runAlfredCommand(deps(), token, { argv, input })
  const turn = async (kind: 'user' | 'wake', said?: string) => store.saveCoordinator({ ...(await store.coordinator(MAIN))!, turn: { kind, at: Date.now(), ...(said ? { said } : {}) } })

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alfred-wf-'))
    store = createPmStore(path.join(dir, 'pm'))
    await store.setEnabled(true)
    await issueAlfredToken(store, dir)
    token = (await fs.readFile(path.join(dir, ALFRED_TOKEN_FILE), 'utf8')).trim()
    await run(['project', 'add', 'WEB', '--machine', '', '--path', '/src/web', '--apply'])
    sent.length = 0
    panes = []
  })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  it('starts a project\'s workflow from an example after its dry run', async () => {
    await expect(run(['project', 'workflow', 'NOPE', '--from', 'company'])).rejects.toThrow('Unknown project NOPE')
    await expect(run(['project', 'workflow', 'WEB', '--from', 'nothing'])).rejects.toThrow('No template or example nothing')
    expect(await run(['project', 'workflow', 'WEB', '--from', 'company'])).toMatchObject({ dryRun: true, change: ['start the workflow of WEB as a copy of example:company'] })
    expect(await store.workflow('WEB')).toBeNull()
    await run(['project', 'workflow', 'WEB', '--from', 'company', '--apply'])
    expect(await store.workflow('WEB')).toMatchObject({ id: 'web', taskTypes: expect.any(Object) })
    expect((await store.project('WEB'))!.from).toMatchObject({ template: 'company' })
  })

  it('proposes a workflow change only in the user\'s turn; the user accepts it in the same review', async () => {
    await expect(run(['project', 'workflow', 'edit', 'WEB'], '{}')).rejects.toThrow('only for a turn that comes from the user')
    await turn('user', 'add a docs step')
    await expect(run(['project', 'workflow', 'edit', 'WEB'], '{}')).rejects.toThrow('Project WEB has no workflow')
    await run(['project', 'workflow', 'WEB', '--from', 'company', '--apply'])
    const wf = (await store.workflow('WEB'))!
    await expect(run(['project', 'workflow', 'edit', 'NOPE'], JSON.stringify(wf))).rejects.toThrow('Unknown project NOPE')
    await expect(run(['project', 'workflow', 'edit', 'WEB'], 'not json')).rejects.toThrow('not valid JSON')
    await expect(run(['project', 'workflow', 'edit', 'WEB'], JSON.stringify({ ...wf, taskTypes: 3 }))).rejects.toThrow('taskTypes')
    await expect(run(['project', 'workflow', 'edit', 'WEB'], JSON.stringify({ ...wf, guards: { protected: ['x'] } }))).rejects.toThrow('use wherdr alfred project guards WEB')
    await turn('wake')
    await expect(run(['project', 'workflow', 'edit', 'WEB'], JSON.stringify({ ...wf, instructions: 'Docs too.' }))).rejects.toThrow('never a wake')
    await turn('user', 'add a docs step')
    expect(await run(['project', 'workflow', 'edit', 'WEB'], JSON.stringify({ ...wf, instructions: 'Docs too.' }))).toMatchObject({ proposed: true })
    expect(await store.workflow('WEB')).toEqual(wf)
    expect((await store.coordinator('WEB'))!.proposal).toMatchObject({ by: 'Alfred', said: 'add a docs step', base: wf.version ?? 1 })
    expect(await answerProposal(deps(), 'WEB', true)).toEqual({ accepted: true })
    expect((await store.workflow('WEB'))!.instructions).toBe('Docs too.')
    expect((await store.workflowLog('WEB')).at(-1)).toMatchObject({ by: 'Alfred', said: 'add a docs step' })
  })

  it('tells a running coordinator, logged as from Alfred, and reads its last reply', async () => {
    await expect(run(['tell', 'NOPE', 'hi'])).rejects.toThrow('Unknown project NOPE')
    await expect(run(['last', 'WEB'])).rejects.toThrow('The coordinator of WEB is not running')
    await store.saveCoordinator({ project: 'WEB', tokenHash: '', terminal: 't-web' })
    panes = [{ id: 'p1', coreAddress: 't-web', status: 'idle' }]
    await turn('user', 'ask WEB for a workflow')
    expect(await run(['tell', 'WEB', 'propose a workflow'])).toMatchObject({ told: 'WEB' })
    expect(sent).toEqual([['terminal.send', { terminal: 't-web', text: 'From Alfred: propose a workflow' }]])
    expect((await store.coordinator('WEB'))!.turn).toMatchObject({ kind: 'user', said: 'ask WEB for a workflow' })
    expect((await store.projectLog('WEB')).at(-1)).toMatchObject({ by: 'Alfred', text: 'told the coordinator: propose a workflow' })
    // In Alfred's wake, the coordinator's turn is a wake too.
    await turn('wake')
    await run(['tell', 'WEB', 'anything blocked?'])
    expect((await store.coordinator('WEB'))!.turn).toMatchObject({ kind: 'wake' })
    expect(await run(['last', 'WEB'])).toEqual({ project: 'WEB', working: false, reply: 'Proposed: see the review' })
  })
})

describe('POST /api/alfred/cli', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock('../server/utils/alfredCli') })
  const call = async (peer: string, headers: Record<string, string>) => {
    const run = vi.fn(async () => ({ ok: true }))
    vi.doMock('../server/utils/alfredCli', () => ({ runAlfredCommand: run }))
    vi.stubGlobal('defineApi', (h: unknown) => h)
    vi.stubGlobal('getRequestHeader', (e: { node: { req: { headers: Record<string, string> } } }, k: string) => e.node.req.headers[k])
    vi.stubGlobal('getRequestURL', () => new URL('http://127.0.0.1:7690/api/alfred/cli'))
    const handler = (await import('../server/api/alfred/cli.post')).default as unknown as (e: unknown, b: unknown) => Promise<unknown>
    const result = await handler({ node: { req: { socket: { remoteAddress: peer }, headers } } }, { argv: ['projects'] }).catch((e: Error) => e)
    return { result, run }
  }

  it('runs a call from this machine with its token', async () => {
    const { result, run } = await call('127.0.0.1', { authorization: `Bearer ${'a'.repeat(64)}` })
    expect(result).toEqual({ ok: true })
    expect(run).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(64), { argv: ['projects'] })
  })

  it('refuses a call from the tailnet, direct or relayed, whatever its token', async () => {
    for (const [peer, headers] of [['100.101.102.103', {}], ['127.0.0.1', { 'x-forwarded-for': '100.101.102.103' }]] as const) {
      const { result, run } = await call(peer, { ...headers, authorization: `Bearer ${'a'.repeat(64)}` })
      expect(result).toMatchObject({ message: 'wherdr alfred works on wherdr\'s own machine only' })
      expect(run).not.toHaveBeenCalled()
    }
  })
})

describe('cliTokenCall (guard)', () => {
  const bearer = `Bearer ${'a'.repeat(64)}`
  it('lets a token stand for the passkey on Alfred\'s route from this machine only', () => {
    expect(cliTokenCall('/api/alfred/cli', { ok: true, zone: 'local' }, bearer)).toBe(true)
    expect(cliTokenCall('/api/alfred/cli', { ok: true, zone: 'tailnet' }, bearer)).toBe(false)
    expect(cliTokenCall('/api/alfred/cli', { ok: true, zone: 'local' }, 'Bearer x')).toBe(false)
    expect(cliTokenCall('/api/pm/cli', { ok: true, zone: 'tailnet' }, bearer)).toBe(true)
    expect(cliTokenCall('/api/settings', { ok: true, zone: 'local' }, bearer)).toBe(false)
  })
})
