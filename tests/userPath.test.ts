import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { USER_PATH_SH, loginShellPath, mergePath, pathFromEnvOutput, projectsEnvPath, userPath } from '../bin/lib/userpath.mjs'
import { servicePath } from '../bin/lib/commands.mjs'
import { enableLinger, lingerOn, systemdUnit } from '../bin/lib/service.mjs'

const tmp: string[] = []
afterEach(() => { for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true }) })
// A home with an agent in ~/.local/bin and ~/.bun/bin, and herdr-projects' record of the login PATH.
function home(record?: string) {
  const h = mkdtempSync(path.join(os.tmpdir(), 'wherdr-path-'))
  tmp.push(h)
  for (const d of ['.local/bin', '.bun/bin']) mkdirSync(path.join(h, d), { recursive: true })
  const agent = path.join(h, '.local/bin/claude')
  writeFileSync(agent, '#!/bin/sh\necho agent\n')
  chmodSync(agent, 0o755)
  if (record !== undefined) {
    mkdirSync(path.join(h, '.herdr-projects/data'), { recursive: true })
    writeFileSync(path.join(h, '.herdr-projects/data/env.json'), record)
  }
  return h
}

describe('mergePath', () => {
  it('keeps the first place of each folder, absolute folders only', () => {
    expect(mergePath('/a:/b', ['/b', '/c'], ':relative::/a/', '')).toBe('/a:/b:/c')
    expect(mergePath(undefined, null, '/x')).toBe('/x')
  })
})

describe('the user\'s PATH', () => {
  it('adds what herdr-projects recorded and the user folders that exist, after the PATH it has', () => {
    const h = home(JSON.stringify({ at: 1, PATH: '/opt/agents/bin:/usr/bin', gh: [] }))
    const p = userPath({ env: { PATH: '/usr/bin:/bin' }, home: h }).split(':')
    expect(p.slice(0, 3)).toEqual(['/usr/bin', '/bin', '/opt/agents/bin'])
    expect(p).toContain(path.join(h, '.local/bin'))
    expect(p).toContain(path.join(h, '.bun/bin'))
    // Folders that do not exist are not added.
    expect(p).not.toContain(path.join(h, '.cargo/bin'))
    expect(new Set(p).size).toBe(p.length)
  })

  it('reads the record from HERDR_PROJECTS_DATA_DIR, and survives a missing or broken one', () => {
    const h = home('{broken')
    expect(projectsEnvPath({}, h)).toBe('')
    const data = path.join(h, 'elsewhere')
    mkdirSync(data)
    writeFileSync(path.join(data, 'env.json'), JSON.stringify({ PATH: '/srv/tools/bin' }))
    expect(projectsEnvPath({ HERDR_PROJECTS_DATA_DIR: data }, h)).toBe('/srv/tools/bin')
    expect(projectsEnvPath({}, path.join(h, 'nobody'))).toBe('')
  })

  it('finds an agent in ~/.local/bin from a systemd-like PATH', () => {
    const h = home()
    const PATH = userPath({ env: { PATH: '/usr/bin:/bin' }, home: h })
    expect(execFileSync('sh', ['-c', 'command -v claude'], { env: { PATH }, encoding: 'utf8' }).trim()).toBe(path.join(h, '.local/bin/claude'))
  })

  it('reads the PATH line of a login shell, whatever it prints before', () => {
    expect(pathFromEnvOutput('Welcome!\nHOME=/h\nPATH=/h/.local/bin:/usr/bin\nX=1')).toBe('/h/.local/bin:/usr/bin')
    expect(pathFromEnvOutput('nothing')).toBe('')
    const run = () => ({ status: 0, stdout: 'motd\nPATH=/from/login:/usr/bin\n' })
    expect(loginShellPath({ SHELL: '/bin/zsh' }, run)).toBe('/from/login:/usr/bin')
    expect(loginShellPath({ SHELL: '/bin/zsh' }, () => ({ status: 1, stdout: '' }))).toBe('')
    expect(loginShellPath({ SHELL: '/bin/zsh' }, () => { throw new Error('no shell') })).toBe('')
  })
})

describe('the login service', () => {
  it('runs with the runtime first, then the login shell\'s PATH and the user folders', () => {
    const h = home(JSON.stringify({ PATH: '/recorded/bin' }))
    const p = servicePath('/opt/node22/bin/node', { PATH: '/usr/bin' }, { home: h, login: '/login/bin:/usr/bin' }).split(':')
    expect(p.slice(0, 4)).toEqual(['/opt/node22/bin', '/usr/bin', '/login/bin', '/recorded/bin'])
    expect(p).toContain(path.join(h, '.local/bin'))
    const unit = systemdUnit({ runtime: '/opt/node22/bin/node', args: ['/w/bin/wherdr.mjs', 'run'], env: { PATH: p.join(':') }, log: '/w/wherdr.log' })
    expect(unit).toContain(`Environment="PATH=/opt/node22/bin:/usr/bin:/login/bin:/recorded/bin:`)
  })

  it('turns lingering on for the user, without sudo, and says when it is refused', () => {
    const calls: string[][] = []
    let linger = 'no'
    const run = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      if (args[0] === 'enable-linger') { linger = 'yes'; return { ok: true, out: '' } }
      return { ok: true, out: `${linger}\n` }
    }
    expect(enableLinger('alice', run)).toEqual({ ok: true, already: false })
    expect(calls).toContainEqual(['loginctl', 'enable-linger', 'alice'])
    expect(calls.every(c => c[0] !== 'sudo')).toBe(true)
    expect(enableLinger('alice', run)).toEqual({ ok: true, already: true })
    const refused = (_: string, args: string[]) => (args[0] === 'enable-linger' ? { ok: false, out: 'Access denied' } : { ok: true, out: 'no' })
    expect(enableLinger('bob', refused)).toEqual({ ok: false, already: false })
    expect(lingerOn('bob', () => ({ ok: false, out: '' }))).toBe(false)
  })
})

describe('the same over SSH (a shell that is not a login shell)', () => {
  it('completes $PATH from the remote record and the user folders, keeping its own order', () => {
    const h = home(JSON.stringify({ at: 1, PATH: '/remote/agents:/usr/bin', gh: [] }))
    const out = execFileSync('sh', ['-c', `${USER_PATH_SH}printf %s "$PATH"`], { env: { HOME: h, PATH: '/usr/bin:/bin' }, encoding: 'utf8' }).split(':')
    expect(out.slice(0, 3)).toEqual(['/usr/bin', '/bin', '/remote/agents'])
    expect(out).toContain(path.join(h, '.local/bin'))
    expect(new Set(out).size).toBe(out.length)
  })

  it('works without a record, and a record outside HOME', () => {
    const h = home()
    const data = path.join(h, 'd')
    mkdirSync(data)
    writeFileSync(path.join(data, 'env.json'), '{\n  "at": 1,\n  "PATH": "/pretty/bin",\n  "gh": []\n}\n')
    const run = (env: Record<string, string>) => execFileSync('sh', ['-c', `${USER_PATH_SH}printf %s "$PATH"`], { env: { HOME: h, PATH: '/bin', ...env }, encoding: 'utf8' })
    expect(run({})).toContain(path.join(h, '.bun/bin'))
    expect(run({ HERDR_PROJECTS_DATA_DIR: data }).split(':')).toContain('/pretty/bin')
  })
})
