// "Open in my terminal": what the server accepts, the script the terminal runs
// (really run with sh here) and how each system opens its terminal.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../server/utils/env', async importOriginal => ({ ...await importOriginal<object>(), log: () => {} }))
vi.mock('../server/utils/state', () => ({ findPane: () => undefined }))
vi.mock('../server/utils/chatFiles', () => ({ chatFilesPolicy: async () => ({ level: 'home', protected: true }) }))
vi.mock('../server/utils/herdr', () => ({
  HerdrError: class HerdrError extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
}))

const { openTerminal, openFileManager, terminalScript, terminalLaunchers, desktopEnv } = await import('../server/utils/openTerminal')

const root = mkdtempSync(path.join(tmpdir(), 'open-terminal-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('terminalScript with a command', () => {
  it('runs it in the folder through the shell, then stays in a shell there', () => {
    const dir = path.join(root, 'cmd-dir')
    mkdirSync(dir, { recursive: true })
    const file = path.join(root, 'cmd.sh')
    writeFileSync(file, terminalScript(dir, '/bin/sh', `printf 'it''s %s\\n' "$(pwd)"`), { mode: 0o700 })
    const r = spawnSync('sh', [file], { input: 'echo again\nexit\n', encoding: 'utf8' })
    expect(r.stdout).toContain(`its ${dir}`)
    expect(r.stdout).toContain('again')
  })
})

describe('terminalScript', () => {
  it('goes to the folder and becomes the shell there, removing itself', () => {
    const dir = path.join(root, "it's here")
    mkdirSync(dir, { recursive: true })
    const file = path.join(root, 'open.sh')
    writeFileSync(file, terminalScript(dir, '/bin/sh'), { mode: 0o700 })
    const r = spawnSync('sh', [file], { input: 'pwd\nexit\n', encoding: 'utf8' })
    expect(r.stdout).toContain(dir)
    expect(existsSync(file)).toBe(false)
  })

  it('a missing folder opens no shell', () => {
    const file = path.join(root, 'gone.sh')
    writeFileSync(file, terminalScript(path.join(root, 'nope'), '/bin/sh'))
    const r = spawnSync('sh', [file], { input: 'echo shell-ran\n', encoding: 'utf8' })
    expect(r.stdout).not.toContain('shell-ran')
  })
})

describe('terminalLaunchers', () => {
  it('Linux: xdg-terminal-exec first, then $TERMINAL', () => {
    expect(terminalLaunchers('linux', { TERMINAL: 'foot --x' }, '/t/open.sh')).toEqual([
      ['xdg-terminal-exec', ['sh', '/t/open.sh']],
      ['foot', ['-e', 'sh', '/t/open.sh']],
    ])
    expect(terminalLaunchers('linux', {}, '/t/open.sh')).toEqual([['xdg-terminal-exec', ['sh', '/t/open.sh']]])
  })

  it('macOS: open on the .command file, the default terminal app runs it', () => {
    expect(terminalLaunchers('darwin', {}, '/t/open.command')).toEqual([['open', ['/t/open.command']]])
  })
})

describe('desktopEnv', () => {
  it('finds the session of a service that has none', () => {
    const e = desktopEnv({ DISPLAY: ':0' }, 1000, () => ['bus', 'wayland-1', 'wayland-1.lock'])
    expect(e).toMatchObject({ XDG_RUNTIME_DIR: '/run/user/1000', WAYLAND_DISPLAY: 'wayland-1', DISPLAY: ':0' })
    expect(desktopEnv({ WAYLAND_DISPLAY: 'w0', XDG_RUNTIME_DIR: '/x' }, 1, () => ['wayland-9'])).toMatchObject({ WAYLAND_DISPLAY: 'w0', XDG_RUNTIME_DIR: '/x' })
  })
})

describe('openTerminal', () => {
  const written: string[] = []
  const launched: string[] = []
  const opened: string[] = []
  const deps = (ok = true) => ({
    findPane: (id: string) => (id.endsWith('w1:p1') ? { cwd: '/home/demo/app' } : undefined),
    folder: async (w: string) => (w === 'src/' ? '/home/demo/app/src' : null),
    write: (t: string) => { written.push(t); return '/t/open.sh' },
    launch: async (s: string) => { launched.push(s); return ok },
    openFolder: async (d: string) => { opened.push(d); return ok },
    shell: '/bin/bash',
  })
  const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code: string }) => e.code)

  it('opens the terminal in the folder, from a browser on this computer', async () => {
    expect(await openTerminal({ pane_id: 'w1:p1', path: 'src/' }, true, deps())).toEqual({ ok: true })
    expect(written.at(-1)).toContain(`cd '/home/demo/app/src'`)
    expect(written.at(-1)).toContain(`exec '/bin/bash' -l`)
    expect(launched).toEqual(['/t/open.sh'])
  })

  it('refuses a remote client, another machine’s agent, unknown panes and folders, opening nothing', async () => {
    launched.length = 0
    expect(await code(openTerminal({ pane_id: 'w1:p1', path: 'src/' }, false, deps()))).toBe('not_local')
    expect(await code(openTerminal({ pane_id: 'ab12~w1:p1', path: 'src/' }, true, deps()))).toBe('not_local')
    expect(await code(openTerminal({ pane_id: 'w9:p9', path: 'src/' }, true, deps()))).toBe('bad_pane')
    expect(await code(openTerminal({ pane_id: '../x', path: 'src/' }, true, deps()))).toBe('bad_pane')
    expect(await code(openTerminal({ pane_id: 'w1:p1', path: ' ' }, true, deps()))).toBe('bad_path')
    expect(await code(openTerminal({ pane_id: 'w1:p1', path: 'nope/' }, true, deps()))).toBe('not_found')
    expect(launched).toEqual([])
  })

  it('says so when no terminal app exists', async () => {
    expect(await code(openTerminal({ pane_id: 'w1:p1', path: 'src/' }, true, deps(false)))).toBe('open_failed')
  })

  it('passes a command to the script and refuses a multi-line one', async () => {
    expect(await openTerminal({ pane_id: 'w1:p1', path: '.', command: 'ls -l' }, true, { ...deps(), folder: async () => '/home/demo/app' })).toEqual({ ok: true })
    expect(written.at(-1)).toContain(`-lc 'ls -l'`)
    expect(await code(openTerminal({ pane_id: 'w1:p1', path: '.', command: 'ls\nrm x' }, true, { ...deps(), folder: async () => '/home/demo/app' }))).toBe('bad_command')
  })

  it('opens the folder in the file manager under the same rules', async () => {
    expect(await openFileManager({ pane_id: 'w1:p1', path: 'src/' }, true, deps())).toEqual({ ok: true })
    expect(opened).toEqual(['/home/demo/app/src'])
    expect(await code(openFileManager({ pane_id: 'w1:p1', path: 'src/' }, false, deps()))).toBe('not_local')
    expect(await code(openFileManager({ pane_id: 'w1:p1', path: 'nope/' }, true, deps()))).toBe('not_found')
    expect(await code(openFileManager({ pane_id: 'w1:p1', path: 'src/' }, true, deps(false)))).toBe('open_failed')
    expect(opened).toEqual(['/home/demo/app/src', '/home/demo/app/src'])
  })
})
