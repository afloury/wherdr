// wherdr.files.read / write (docs/plugins.md): the shell script runs for real in a
// temporary home, with a project (a Git repository), hidden folders and symlinks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLUGIN_FILE_SCRIPT, pluginPathOk, pluginReadFile, pluginWriteFile } from '../server/utils/pluginFiles'
import type { CoreAdminDeps } from '../server/utils/coreCreate'

let home = ''
const sh = (mode: string, path: string, data = '', input?: string) =>
  spawnSync('sh', ['-c', PLUGIN_FILE_SCRIPT, 'sh', mode, data, path], { env: { PATH: process.env.PATH, HOME: home }, input: input ?? '', encoding: 'utf8' })

beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'plugin-files-')))
  mkdirSync(join(home, 'app/.git'), { recursive: true })
  mkdirSync(join(home, 'app/src'), { recursive: true })
  writeFileSync(join(home, 'app/README.md'), 'hello\n')
  mkdirSync(join(home, 'notes'))
  writeFileSync(join(home, 'notes/a.txt'), 'x')
  mkdirSync(join(home, '.ssh'))
  writeFileSync(join(home, '.ssh/id'), 'secret')
  mkdirSync(join(home, 'app/.git/hooks'), { recursive: true })
  mkdirSync(join(home, 'data/.git'), { recursive: true }) // a DATA_DIR that happens to be a repo
  symlinkSync(join(home, '.ssh/id'), join(home, 'app/link'))
  symlinkSync(join(home, '.ssh'), join(home, 'app/sshdir'))
})
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe('pluginPathOk (lexical)', () => {
  it('takes plain absolute paths, refuses the rest', () => {
    expect(pluginPathOk('/home/u/app/.wherdr/tasks.json')).toBe('/home/u/app/.wherdr/tasks.json')
    for (const bad of ['app/x', '/home/u/../etc/passwd', '/home/u/.ssh/id', '/home/u/app/.git/config', '/home/u/app/.env', '/', 'x\n', 3, null]) expect(pluginPathOk(bad)).toBeNull()
  })
})

describe('the file script', () => {
  it('reads a file of a project, null-code for a missing one', () => {
    expect(sh('read', `${home}/app/README.md`)).toMatchObject({ status: 0, stdout: 'hello\n' })
    expect(sh('read', `${home}/app/.wherdr/tasks.json`).status).toBe(17)
  })
  it('writes in .wherdr, making the folder, and replaces in one step', () => {
    expect(sh('write', `${home}/app/.wherdr/tasks.json`, '', '{"tasks":[]}').status).toBe(0)
    expect(readFileSync(join(home, 'app/.wherdr/tasks.json'), 'utf8')).toBe('{"tasks":[]}')
    expect(sh('write', `${home}/app/.wherdr/tasks.json`, '', '{"tasks":[1]}').status).toBe(0)
    expect(readFileSync(join(home, 'app/.wherdr/tasks.json'), 'utf8')).toBe('{"tasks":[1]}')
  })
  it('refuses outside a project, hidden folders, the home, DATA_DIR and symlinks', () => {
    expect(sh('read', `${home}/notes/a.txt`).status).toBe(15) // not a Git repository
    expect(sh('read', `${home}/.ssh/id`).status).toBe(13)
    expect(sh('write', `${home}/app/.git/hooks/pre-commit`, '', 'x').status).toBe(13)
    expect(sh('read', `${home}/README`).status).toBe(12)
    expect(sh('read', '/etc/passwd').status).toBe(12)
    expect(sh('read', `${home}/app/link`).status).toBe(16)
    expect(sh('read', `${home}/app/sshdir/id`).status).toBe(13) // resolved to ~/.ssh
    expect(sh('write', `${home}/app/sshdir/x`, '', 'x').status).toBe(13)
    expect(sh('write', `${home}/data/x.json`, `${home}/data`, 'x').status).toBe(14)
    expect(existsSync(join(home, 'data/x.json'))).toBe(false)
  })
})

describe('pluginReadFile / pluginWriteFile', () => {
  const deps = {
    machines: () => [{ key: '', label: 'Local', local: true, status: 'online', error: null }],
    call: async (method: string, p: { argv: string[], input?: string }) => {
      expect(method).toBe('machine.exec')
      const r = spawnSync(p.argv[0]!, p.argv.slice(1), { env: { PATH: process.env.PATH, HOME: home }, input: p.input ? Buffer.from(p.input, 'base64') : '' })
      return { code: r.status, stdout: r.stdout.toString('base64') }
    },
  } as unknown as CoreAdminDeps
  it('round-trips a file and gives null for a missing one', async () => {
    const path = `${home}/app/.wherdr/board.json`
    expect(await pluginReadFile(deps, { path })).toEqual({ text: null })
    expect(await pluginWriteFile(deps, { path, text: 'é ✓\n' })).toEqual({ ok: true })
    expect(await pluginReadFile(deps, { path })).toEqual({ text: 'é ✓\n' })
  })
  it('says why it refuses', async () => {
    await expect(pluginReadFile(deps, { path: `${home}/notes/a.txt` })).rejects.toThrow(/project folder/)
    await expect(pluginReadFile(deps, { path: 'relative' })).rejects.toThrow(/Invalid path/)
    await expect(pluginWriteFile(deps, { path: `${home}/app/x`, text: 'x'.repeat(201 * 1024) })).rejects.toThrow(/too large/)
    await expect(pluginReadFile(deps, { path: `${home}/app/x`, machine: 'nope' })).rejects.toThrow(/unknown machine/)
  })
})
