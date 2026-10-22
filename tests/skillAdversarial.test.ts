// Adversarial review of the skill installer (PR #11). Every test runs in a
// temporary HOME. Tests named "DEFECT" describe the behaviour a user expects
// and fail on the reviewed head; the others pin behaviour that already holds.
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { realIo, refreshInstalledSkill, runUpdate } from '../bin/lib/updater.mjs'

const repo = path.resolve('.')
const helper = path.join(repo, 'bin/lib/install-skill.sh')
const temporary: string[] = []
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function home() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'wherdr-adv-')))
  temporary.push(dir)
  return dir
}
// Only what the helper needs: no variable of the real session leaks in.
const env = (h: string, extra: Record<string, string> = {}) => ({ HOME: h, PATH: process.env.PATH ?? '', ...extra })
const sh = (h: string, args: string[] = [], extra: Record<string, string> = {}, cwd = h) =>
  spawnSync('sh', [helper, ...args], { env: env(h, extra), cwd, encoding: 'utf8' })
const source = readFileSync(path.join(repo, 'skills/wherdr/SKILL.md'), 'utf8')

describe('skill helper: nothing is damaged', () => {
  it('leaves a foreign file, directory, link and dangling link at the agent path', () => {
    for (const make of [
      (p: string) => writeFileSync(p, 'file'),
      (p: string) => { mkdirSync(p); writeFileSync(path.join(p, 'SKILL.md'), 'mine') },
      (p: string) => symlinkSync('/nonexistent/elsewhere', p),
      (p: string) => symlinkSync('wherdr', p), // points at itself
    ]) {
      const h = home()
      const link = path.join(h, '.claude/skills/wherdr')
      mkdirSync(path.dirname(link), { recursive: true })
      make(link)
      const before = lstatSync(link)
      expect(sh(h).status).toBe(0)
      const after = lstatSync(link)
      expect([after.ino, after.mtimeMs, after.size]).toEqual([before.ino, before.mtimeMs, before.size])
    }
  })

  it('creates nothing without an agent, with a missing or empty HOME, or in a read-only home', () => {
    const h = home()
    expect(sh(h).status).toBe(0)
    expect(existsSync(path.join(h, 'wherdr'))).toBe(false)
    expect(spawnSync('sh', [helper], { env: { PATH: process.env.PATH ?? '' } }).status).toBe(0)
    expect(spawnSync('sh', [helper], { env: { PATH: process.env.PATH ?? '', HOME: '' } }).status).toBe(0)
  })

  it('handles spaces in every path', () => {
    const h = path.join(home(), 'my home')
    const claude = path.join(h, 'claude config')
    mkdirSync(claude, { recursive: true })
    sh(h, [], { CLAUDE_CONFIG_DIR: claude, WHERDR_DIR: path.join(h, 'w dir') })
    expect(readFileSync(path.join(claude, 'skills/wherdr/SKILL.md'), 'utf8')).toBe(source)
  })

  it('DEFECT: a link made by a wherdr with a temporary WHERDR_DIR is repaired once that folder is gone', () => {
    const h = home()
    mkdirSync(path.join(h, '.claude'))
    const trial = path.join(h, 'trial')
    sh(h, [], { WHERDR_DIR: trial }) // a test instance, a trial run, a second install
    rmSync(trial, { recursive: true })
    sh(h) // the regular wherdr of this user, on every start from now on
    expect(readFileSync(path.join(h, '.claude/skills/wherdr/SKILL.md'), 'utf8')).toBe(source)
  })

  it('DEFECT: a relative WHERDR_DIR does not produce a broken link', () => {
    const h = home()
    mkdirSync(path.join(h, '.claude'))
    sh(h, [], { WHERDR_DIR: 'data' })
    expect(existsSync(path.join(h, '.claude/skills/wherdr/SKILL.md'))).toBe(true)
  })

  it('DEFECT: a relative CLAUDE_CONFIG_DIR does not write into the project wherdr was started from', () => {
    const h = home()
    const project = path.join(h, 'project')
    mkdirSync(path.join(project, '.claude'), { recursive: true })
    sh(h, [], { CLAUDE_CONFIG_DIR: '.claude' }, project)
    expect(existsSync(path.join(project, '.claude/skills'))).toBe(false)
  })
})

describe('skill helper: nothing is rewritten or forced', () => {
  it('DEFECT: an unchanged skill is not rewritten on the next start', () => {
    const h = home()
    mkdirSync(path.join(h, '.claude'))
    sh(h)
    const file = path.join(h, 'wherdr/skills/wherdr/SKILL.md')
    const before = statSync(file)
    sh(h)
    const after = statSync(file)
    expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs])
  })

  it('DEFECT: the documented uninstall survives the next start', () => {
    const h = home()
    mkdirSync(path.join(h, '.claude'))
    sh(h)
    sh(h, ['uninstall'])
    expect(existsSync(path.join(h, '.claude/skills/wherdr'))).toBe(false)
    sh(h) // what `wherdr`, `wherdr start` and the login service run
    expect(existsSync(path.join(h, '.claude/skills/wherdr'))).toBe(false)
  })

  it('DEFECT: uninstall removes the copy when the agent folder is gone', () => {
    const h = home()
    mkdirSync(path.join(h, '.claude'))
    sh(h)
    renameSync(path.join(h, '.claude'), path.join(h, '.claude.bak'))
    sh(h, ['uninstall'])
    expect(existsSync(path.join(h, 'wherdr/skills/wherdr/SKILL.md'))).toBe(false)
  })
})

// One-tap update with the real helper: package folders hold a skill per version.
describe('one-tap update: which skill is left in place', () => {
  function setup(previousHasHelper: boolean) {
    const h = home()
    mkdirSync(path.join(h, '.claude'))
    const dir = path.join(h, 'wherdr')
    const root = path.join(dir, 'app')
    const pkg = (at: string, text: string, withHelper: boolean) => {
      mkdirSync(path.join(at, 'skills/wherdr'), { recursive: true })
      writeFileSync(path.join(at, 'skills/wherdr/SKILL.md'), text)
      if (withHelper) cpSync(path.join(repo, 'bin'), path.join(at, 'bin'), { recursive: true })
    }
    pkg(root, 'old skill', previousHasHelper)
    pkg(`${root}.new`, 'new skill', true)
    const plan = { kind: 'plugin', from: '1.0.0', to: '2.0.0', root, dir, runtime: '/usr/bin/node', serverPid: 0, port: '1', host: '127.0.0.1', releaseBase: 'https://releases.example', healthMs: 10 }
    const io = {
      log: () => {}, state: () => {},
      async run(cmd: string, args: string[], extra: Record<string, string> = {}) {
        if (cmd === 'sh') execFileSync(cmd, args, { env: env(h, extra) })
      },
      async download() {}, async verify() {}, async stopServer() {},
      healthy: async (version: string) => version === '1.0.0', // 2.0.0 never answers
      exists: (p: string) => existsSync(p) || p.endsWith('/.output/server/index.mjs'),
      rm: (p: string) => { if (!p.endsWith('.new')) rmSync(p, { recursive: true, force: true }) },
      mkdir: () => {}, copy: () => {},
      rename: (a: string, b: string) => renameSync(a, b),
      realpath: (p: string) => p,
    }
    return { plan, io, skill: path.join(h, '.claude/skills/wherdr/SKILL.md') }
  }

  it('rollback puts the previous skill back when the previous package bundles the helper', async () => {
    const { plan, io, skill } = setup(true)
    expect(await runUpdate(plan, io)).toBe('rolled-back')
    expect(readFileSync(skill, 'utf8')).toBe('old skill')
  })

  // Review point 4 is intentionally retained and documented in README.
  it.fails('DEFECT: rollback to a package without the helper (1.3.2) does not leave the failed version\'s skill', async () => {
    const { plan, io, skill } = setup(false)
    expect(await runUpdate(plan, io)).toBe('rolled-back')
    expect(existsSync(skill) ? readFileSync(skill, 'utf8') : '').not.toBe('new skill')
  })

  it('DEFECT: Homebrew, a failing lookup of the opt link for the skill does not fail the restart', async () => {
    const calls: string[] = []
    let lookups = 0
    const io = {
      log: () => {}, state: () => {},
      async run(cmd: string, args: string[]) { calls.push([cmd, ...args].join(' ')) },
      async download() {}, async stopServer() {},
      healthy: async () => true,
      exists: () => false, rm: () => {}, mkdir: () => {}, copy: () => {}, rename: () => {},
      // install() resolves the link; the lookup added for the skill then fails.
      realpath: () => { if (++lookups > 1) throw new Error('ENOENT'); return '/opt/homebrew/Cellar/wherdr/1.3.1' },
    }
    const plan = { kind: 'brew', from: '1.3.0', to: '1.3.1', root: '/opt/homebrew/Cellar/wherdr/1.3.0/libexec/lib/node_modules/wherdr', dir: '/tmp/none', runtime: '/usr/bin/node', serverPid: 0, port: '1', host: '127.0.0.1', registry: '', healthMs: 10 }
    await runUpdate(plan, io)
    expect(calls).toContain('/opt/homebrew/bin/brew services restart wherdr')
  })
})


it('the managed link target is the stable copy, never the package folder', () => {
  const h = home()
  mkdirSync(path.join(h, '.codex'))
  sh(h)
  expect(readlinkSync(path.join(h, '.agents/skills/wherdr'))).toBe(path.join(h, 'wherdr/skills/wherdr'))
})

it('does not repair an unrecorded foreign dangling link with a managed-looking path', () => {
  const h = home()
  const link = path.join(h, '.claude/skills/wherdr')
  mkdirSync(path.dirname(link), { recursive: true })
  const foreign = path.join(h, 'someone-else/skills/wherdr')
  symlinkSync(foreign, link)
  const before = lstatSync(link)
  sh(h)
  expect(readlinkSync(link)).toBe(foreign)
  expect(lstatSync(link).ino).toBe(before.ino)
})

it('preserves the management marker as well as unchanged skill content', () => {
  const h = home()
  mkdirSync(path.join(h, '.claude'))
  sh(h)
  const marker = path.join(h, 'wherdr/skills/wherdr/.wherdr-managed')
  const before = statSync(marker)
  sh(h)
  expect(statSync(marker).mtimeMs).toBe(before.mtimeMs)
})

it('requires explicit installation to clear uninstall, and off prevents that too', () => {
  const h = home()
  mkdirSync(path.join(h, '.claude'))
  const file = path.join(h, '.claude/skills/wherdr/SKILL.md')
  sh(h, [], { WHERDR_SKILL: 'off' })
  expect(existsSync(path.join(h, 'wherdr'))).toBe(false)
  sh(h)
  const before = statSync(file)
  sh(h, ['install'], { WHERDR_SKILL: 'off' })
  expect(statSync(file).mtimeMs).toBe(before.mtimeMs)
  sh(h, ['uninstall'])
  sh(h, ['install'], { WHERDR_SKILL: 'off' })
  sh(h, [], { WHERDR_DIR: path.join(h, 'another-install') })
  expect(existsSync(file)).toBe(false)
  expect(existsSync(path.join(h, 'another-install'))).toBe(false)
  expect(sh(h, ['install']).status).toBe(0)
  expect(readFileSync(file, 'utf8')).toBe(source)
  expect(existsSync(path.join(h, '.local/state/wherdr/skill-disabled'))).toBe(false)
})



it('bounds updater helper execution and requests the bounded refresh mode', async () => {
  const h = home()
  const plan = { dir: h, root: h, runtime: process.execPath }
  const io = realIo(plan)
  await expect(io.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {}, { timeout: 100 })).rejects.toThrow('timed out')
  const calls: unknown[][] = []
  const fake = { exists: () => true, run: async (...args: unknown[]) => { calls.push(args) } }
  expect(await refreshInstalledSkill(plan, fake)).toBe(true)
  expect(calls[0]).toEqual(['sh', [path.join(h, 'bin/lib/install-skill.sh'), 'refresh', h], { WHERDR_DIR: h }, { timeout: 5000 }])
})
