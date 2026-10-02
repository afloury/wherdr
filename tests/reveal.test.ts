// "Reveal in Finder" / "Open": the server checks, then the real script run
// here through the same two shells as over SSH, with a fake `open` and `uname`
// that record what they were given (nothing is ever opened).
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
