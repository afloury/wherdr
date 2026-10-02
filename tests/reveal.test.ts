// "Reveal in Finder" / "Open": the server checks, then the real script run
// here through the same two shells as over SSH, with a fake `open` and `uname`
// that record what they were given (nothing is ever opened).
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { remoteCommand } from '../server/utils/fsx'

const root = mkdtempSync(path.join(tmpdir(), 'reveal-'))
const home = path.join(root, 'home')
const bin = path.join(root, 'bin')
const calls = path.join(root, 'calls.log')
const env = vi.hoisted(() => ({ os: 'Darwin', pane: { id: 'w1:p1', cwd: '' } as { id: string, cwd: string } | null, logs: [] as string[] }))

mkdirSync(path.join(home, 'project/src'), { recursive: true })
mkdirSync(path.join(home, 'Tool.app'), { recursive: true })
mkdirSync(bin)
writeFileSync(path.join(home, 'project/src/app.ts'), '')
writeFileSync(path.join(home, 'project/My Notes.md'), '')
writeFileSync(path.join(home, 'project/run'), '#!/bin/sh\n')
chmodSync(path.join(home, 'project/run'), 0o755)
writeFileSync(path.join(root, 'secret.txt'), '')
symlinkSync(path.join(root, 'secret.txt'), path.join(home, 'project/link.txt'))
writeFileSync(path.join(bin, 'open'), `#!/bin/sh\nfor a; do printf '%s|' "$a"; done >> "${calls}"\necho >> "${calls}"\n`)
writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho "$FAKE_OS"\n')
chmodSync(path.join(bin, 'open'), 0o755)
chmodSync(path.join(bin, 'uname'), 0o755)
afterAll(() => rmSync(root, { recursive: true, force: true }))

// Remote machine whose "SSH" is a local login shell running the same command line.
const exec = async (script: string, args: string[] = []) => {
  const r = spawnSync('/bin/sh', ['-c', remoteCommand(script, args)], {
    cwd: home,
    env: { HOME: home, PATH: `${bin}:${process.env.PATH}`, FAKE_OS: env.os },
  })
  return { code: r.status, stdout: r.stdout, stderr: String(r.stderr || '') }
}
const machine = { key: 'abcd1234', label: 'Test Mac', local: false, status: 'online', home, get os() { return env.os }, exec }

vi.mock('../server/utils/env', () => ({ log: (s: string) => env.logs.push(s) }))
vi.mock('../server/utils/state', () => ({ findPane: (id: string) => (env.pane && env.pane.id === id ? env.pane : undefined) }))
vi.mock('../server/utils/machines', () => ({ getMachine: (k: string) => (k === 'abcd1234' ? machine : undefined) }))
vi.mock('../server/utils/herdr', () => ({
  HerdrError: class HerdrError extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
}))

const { revealPath, REVEAL_SCRIPT } = await import('../server/utils/reveal')
const PANE = 'abcd1234~w1:p1'
const opened = () => { try { return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) } catch { return [] } }
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code)

beforeEach(() => {
  env.os = 'Darwin'
  env.pane = { id: PANE, cwd: path.join(home, 'project') }
  rmSync(calls, { force: true })
})

describe('reveal: success', () => {
  it('reveals a relative path from the agent folder with open -R', async () => {
    const r = await revealPath({ pane_id: PANE, path: 'src/app.ts:12', mode: 'reveal' })
    expect(r).toMatchObject({ ok: true, mode: 'reveal', machine: 'Test Mac' })
    expect(opened()).toEqual([`-R|${path.join(home, 'project/src/app.ts')}|`])
    expect(env.logs.at(-1)).toMatch(/^reveal: reveal on Test Mac for abcd1234~w1:p1: ok$/)
  })

  it('opens a document with spaces in its name, as one argument', async () => {
    await revealPath({ pane_id: PANE, path: '~/project/My Notes.md', mode: 'open' })
    expect(opened()).toEqual([`${path.join(home, 'project/My Notes.md')}|`])
  })

  it('reveals an app bundle (but does not open it)', async () => {
    await revealPath({ pane_id: PANE, path: '~/Tool.app', mode: 'reveal' })
    expect(opened()).toHaveLength(1)
    expect(await codeOf(revealPath({ pane_id: PANE, path: '~/Tool.app', mode: 'open' }))).toBe('runnable')
  })
})

describe('reveal: refusals', () => {
  it('needs a known pane and a valid action', async () => {
    expect(await codeOf(revealPath({ pane_id: 'w9:p9', path: 'a.ts', mode: 'reveal' }))).toBe('bad_pane')
    expect(await codeOf(revealPath({ pane_id: 'x; rm', path: 'a.ts', mode: 'reveal' }))).toBe('bad_pane')
    expect(await codeOf(revealPath({ pane_id: PANE, path: 'a.ts', mode: 'exec' }))).toBe('bad_mode')
    expect(await codeOf(revealPath({ pane_id: PANE, path: '', mode: 'reveal' }))).toBe('bad_path')
  })

  it('refuses a machine that is not a Mac', async () => {
    env.os = 'Linux'
    expect(await codeOf(revealPath({ pane_id: PANE, path: 'src/app.ts', mode: 'reveal' }))).toBe('not_mac')
  })

  it('refuses paths outside home, before and after symlinks', async () => {
    expect(await codeOf(revealPath({ pane_id: PANE, path: '/etc/passwd', mode: 'reveal' }))).toBe('outside_home')
    expect(await codeOf(revealPath({ pane_id: PANE, path: '../../secret.txt', mode: 'reveal' }))).toBe('outside_home')
    expect(await codeOf(revealPath({ pane_id: PANE, path: 'link.txt', mode: 'open' }))).toBe('outside_home')
    expect(opened()).toEqual([])
  })

  it('reports a missing file', async () => {
    const e = await revealPath({ pane_id: PANE, path: 'src/nope.ts', mode: 'reveal' }).catch(x => x)
    expect(e.code).toBe('not_found')
    expect(e.message).toContain('Test Mac')
  })

  it('does not open executables or scripts', async () => {
    expect(await codeOf(revealPath({ pane_id: PANE, path: 'run', mode: 'open' }))).toBe('runnable')
    expect(await codeOf(revealPath({ pane_id: PANE, path: 'x.command', mode: 'open' }))).toBe('runnable')
    expect(opened()).toEqual([])
  })
})

describe('SSH command line', () => {
  it('passes a hostile path verbatim as $2, never as shell text', async () => {
    const evil = `${home}/a'; touch pwned; echo '$(touch pwned2)\`id\`.txt`
    writeFileSync(evil, '')
    await revealPath({ pane_id: PANE, path: evil, mode: 'reveal' }).catch(() => {})
    const r = await exec('printf %s "$2"', ['reveal', evil])
    expect(r.stdout.toString()).toBe(evil)
    for (const f of ['pwned', 'pwned2']) expect(() => readFileSync(path.join(home, f))).toThrow()
  })

  it('quotes every part of the command', () => {
    expect(remoteCommand('echo "$1"', ["it's"])).toBe(`sh -c 'echo "$1"' sh 'it'\\''s'`)
    expect(REVEAL_SCRIPT).toContain('open -R "$r"')
  })
})

describe('host open (wherdr in a container on a Mac)', () => {
  it('REVEAL_SCRIPT is the checks part of scripts/reveal.sh verbatim', () => {
    // The file adds a header comment above the checks; the script body must match.
    const body = readFileSync('scripts/reveal.sh', 'utf8').replace(/^#.*\n/gm, '').replace(/^\n+/, '').replace(/\n$/, '')
    expect(REVEAL_SCRIPT).toBe(body)
  })

  it('the wrapper accepts only open <mode> <base64> and install <name> <data>', () => {
    // The forced command whitelist, replayed without SSH: SSH_ORIGINAL_COMMAND.
    const run = (orig: string, keyFile = 'missing') => {
      const r = spawnSync('/bin/sh', [path.join('scripts', 'wherdr-open.sh')], {
        env: { ...process.env, HOME: home, SSH_ORIGINAL_COMMAND: orig, WH_OPEN_REVEAL: keyFile },
      })
      return r.status
    }
    const mode = 'open'
    const p64 = Buffer.from('/tmp/x').toString('base64')
    // Missing reveal.sh (WH_OPEN_REVEAL points nowhere): refused before anything runs.
    expect(run(`open ${mode} ${p64}`)).toBe(126)
    expect(run('rm -rf /')).toBe(126)
    expect(run('open evil-notbase64!!')).toBe(126)
    expect(run('open reveal')).toBe(126)
    expect(run(`open bake ${p64}`)).toBe(126)
    expect(run('')).toBe(126)
    // install: only the two known file names; the content arrives on stdin.
    const target = path.join(home, '.local/share/wherdr/reveal.sh')
    mkdirSync(path.dirname(target), { recursive: true })
    const runWithStdin = (orig: string, stdin: string, keyFile = 'missing') => {
      const r = spawnSync('/bin/sh', [path.join('scripts', 'wherdr-open.sh')], {
        input: stdin,
        env: { ...process.env, HOME: home, SSH_ORIGINAL_COMMAND: orig, WH_OPEN_REVEAL: keyFile },
      })
      return r.status
    }
    expect(runWithStdin('install reveal.sh', '#!/bin/sh\ncontent\n')).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('#!/bin/sh\ncontent\n')
    expect(run('install ../evil')).toBe(126)
    expect(run('install not-a-file')).toBe(126)
    expect(run('install')).toBe(126)
  })

  it('the wrapper runs reveal.sh with the decoded path', () => {
    // reveal.sh stub: records mode and path, "opens" into calls.log.
    const stub = path.join(root, 'stub-reveal.sh')
    writeFileSync(stub, `#!/bin/sh\nprintf '%s %s|' "$1" "$2" >> "${calls}"\necho >> "${calls}"\n`)
    const run = (orig: string) => {
      const r = spawnSync('/bin/sh', [path.join('scripts', 'wherdr-open.sh')], {
        env: { ...process.env, SSH_ORIGINAL_COMMAND: orig, WH_OPEN_REVEAL: stub },
      })
      return r.status
    }
    const withSpaces = `${home}/project/My Notes.md`
    expect(run(`open open ${Buffer.from(withSpaces).toString('base64')}`)).toBe(0)
    expect(run(`open reveal ${Buffer.from(home).toString('base64')}`)).toBe(0)
    expect(opened()).toEqual([`open ${withSpaces}|`, `reveal ${home}|`])
  })

  it('reveal.sh opens a folder with the configured editor, files with open', () => {
    // Fake `open` records its arguments; the editor name is pre-written to the
    // file the script reads (~/.local/share/wherdr/editor under $HOME).
    const bin = path.join(root, 'bin2')
    mkdirSync(bin, { recursive: true })
    writeFileSync(path.join(bin, 'open'), `#!/bin/sh\nfor a; do printf '%s|' "$a"; done >> "${calls}"\necho >> "${calls}"\n`)
    writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho Darwin\n')
    chmodSync(path.join(bin, 'open'), 0o755)
    chmodSync(path.join(bin, 'uname'), 0o755)
    mkdirSync(path.join(home, '.local/share/wherdr'), { recursive: true })
    writeFileSync(path.join(home, '.local/share/wherdr/editor'), 'Zed\n')
    const run = (mode: string, p: string) => spawnSync('/bin/sh', ['scripts/reveal.sh', mode, p], {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home },
    })
    const dir = path.join(home, 'project')
    const r1 = run('open', dir)
    expect(r1.status).toBe(0)
    const real = realpathSync(dir)
    expect(r1.stdout.toString().trim()).toBe(real)
    expect(opened().at(-1)).toBe(`-a|Zed|${real}|`)
    const r2 = run('open', path.join(home, 'project/My Notes.md'))
    expect(r2.status).toBe(0)
    const realFile = realpathSync(path.join(home, 'project/My Notes.md'))
    expect(opened().at(-1)).toBe(`${realFile}|`)
  })
})
