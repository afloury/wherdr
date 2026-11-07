// WHR-404: `wherdr alfred`, Alfred's own command: parsing, the dry run shown
// before a change, and the server's run with its token from Alfred's home.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dryRun, parseAlfredCommand } from '../shared/pm/alfredCli'
import { runAlfredCommand } from '../server/utils/alfredCli'
import { ALFRED_TOKEN_FILE, issueAlfredToken } from '../server/utils/pmCoordinator'
import { createPmStore } from '../server/utils/pmStore'
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
    expect(parseAlfredCommand(['coordinator', 'start', 'WEB', '--program', 'codex', '--model', 'gpt-6'])).toEqual({ name: 'coordinator start', apply: false, key: 'WEB', program: 'codex', model: 'gpt-6' })
    expect(parseAlfredCommand(['setting', 'set', 'theme', 'dark', '--apply'])).toEqual({ name: 'setting set', apply: true, key: 'theme', value: 'dark' })
  })

  it('says what is wrong', () => {
    expect(parseAlfredCommand(['project', 'add', 'WEB', '--path', '/x'])).toEqual({ error: 'usage: wherdr alfred project add <KEY> --machine <key> --path <folder> [--name <name>] [--template <id>] [--apply]' })
    expect(parseAlfredCommand(['project', 'add', 'WEB', '--machine', '', '--path', '/x', '--force', 'y'])).toEqual({ error: 'unknown option --force' })
    expect(parseAlfredCommand(['coordinator', 'start', 'WEB', '--program', 'gemini', '--model', 'x'])).toEqual({ error: '--program is claude or codex' })
    expect(parseAlfredCommand(['coordinator', 'start', 'WEB', '--model', 'x'])).toEqual({ error: '--program and --model go together' })
    expect(parseAlfredCommand(['setting', 'set', 'password', 'x'])).toMatchObject({ error: /^Unknown setting password/ })
    expect(parseAlfredCommand(['project', 'remove', 'WEB'])).toMatchObject({ error: /^unknown command: project remove WEB/ })
    expect(parseAlfredCommand('projects')).toEqual({ error: 'argv must be a list of words' })
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
  const deps = () => ({
    store, machines: () => machines, panes: () => [], urls: { local: 'http://127.0.0.1:7690' }, settingsFile: path.join(dir, 'settings.json'),
    check: async (m: string, f: string) => { checked.push(`${m}:${f}`); return f },
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
  })
  afterEach(() => fs.rm(dir, { recursive: true, force: true }))

  it('keeps its token in a private file of its home; another token is refused', async () => {
    expect((await fs.stat(path.join(dir, ALFRED_TOKEN_FILE))).mode & 0o777).toBe(0o600)
    await expect(runAlfredCommand(deps(), 'f'.repeat(64), { argv: ['projects'] })).rejects.toThrow('Unknown Alfred token')
    await issueAlfredToken(store, dir) // a new start: the old token stops working
    await expect(run('projects')).rejects.toThrow('Unknown Alfred token')
  })

  it('shows a change, then makes it with --apply only', async () => {
    const shown = await run('project', 'add', 'WEB', '--machine', 'Mac', '--path', '/src/web')
    expect(shown).toMatchObject({ dryRun: true, change: ['add project WEB "WEB"', 'folder /src/web on Mac (checked to be a git repository)', 'template none'], remote: expect.stringContaining('Mac') })
    expect(checked).toEqual([])
    expect(await store.projects()).toEqual([])
    expect(await run('project', 'add', 'WEB', '--machine', 'mac', '--path', '/src/web', '--apply')).toMatchObject({ applied: true, result: { key: 'WEB', machine: 'mac' } })
    expect(checked).toEqual(['mac:/src/web'])
    expect(await run('project', 'template', 'WEB', 'common')).toMatchObject({ dryRun: true, change: ['project WEB template: none → common'] })
    await run('project', 'template', 'WEB', 'common', '--apply')
    expect(await run('projects')).toMatchObject({ enabled: true, projects: [{ key: 'WEB', template: 'common', machineName: 'Mac' }] })
    await expect(run('project', 'template', 'WEB', 'nope')).rejects.toThrow('No template nope')
  })

  it('changes a setting after its dry run', async () => {
    expect(await run('setting', 'set', 'theme', 'dark')).toMatchObject({ dryRun: true, change: ['setting theme: (default) → "dark"'] })
    expect(await run('settings')).toEqual({ settings: {} })
    await run('setting', 'set', 'theme', 'dark', '--apply')
    expect(await run('settings')).toEqual({ settings: { theme: 'dark' } })
    expect(await run('setting', 'set', 'theme', 'dark')).toEqual({ unchanged: true, theme: 'dark' })
  })
})
