// docs/herdr-projects-1x.md: the way back to 0.2 runs as written, on a HOME
// shaped as herdr-projects 1.2.1 leaves it (its moved.json, a `-legacy-2`
// because an older `-legacy` was there, and folders already at the old places).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROJECTS_MIGRATION_GUIDE } from '../shared/projectsPlugin'

const REPO = path.resolve(import.meta.dirname, '..')
const guide = readFileSync(path.join(REPO, PROJECTS_MIGRATION_GUIDE), 'utf8')
const back = guide.slice(guide.indexOf('## Going back to 0.2'))
// The block of step 3, as the reader copies it.
const script = [...back.matchAll(/```sh\n([\s\S]*?)```/g)].map(m => m[1]!.replace(/^ {3}/gm, '')).find(b => b.includes('restore()'))!

let home = ''
afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }) })

function setUp() {
  home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-guide-'))
  const at = (p: string) => path.join(home, p)
  // What 1.2.1 left: the 0.2 projects in -legacy-2, its settings in -legacy, its own board in ~/.herdr-projects.
  mkdirSync(at('.herdr-projects-legacy/older'), { recursive: true })
  mkdirSync(at('.herdr-projects-legacy-2/acme'), { recursive: true })
  writeFileSync(at('.herdr-projects-legacy-2/acme/PROJECT.md'), '# Acme\n')
  mkdirSync(at('.config/herdr-projects-legacy'), { recursive: true })
  writeFileSync(at('.config/herdr-projects-legacy/config.toml'), 'root = "~/.herdr-projects"\n')
  mkdirSync(at('.herdr-projects/data'), { recursive: true })
  writeFileSync(at('.herdr-projects/moved.json'), JSON.stringify({ legacy: {
    projects: { from: at('.herdr-projects'), to: at('.herdr-projects-legacy-2'), at: 1 },
    settings: { from: at('.config/herdr-projects'), to: at('.config/herdr-projects-legacy'), at: 1 },
  } }, null, 2))
  // Already at an old place: a settings folder made since, and a name the set-aside must not reuse.
  mkdirSync(at('.config/herdr-projects'), { recursive: true })
  writeFileSync(at('.config/herdr-projects/made-since'), '')
  mkdirSync(at('.herdr-projects.from-1x-1'))
  return at
}
const run = () => execFileSync('sh', ['-c', script], { env: { HOME: home, PATH: process.env.PATH }, encoding: 'utf8' })

describe.skipIf(process.platform === 'win32')('herdr-projects 1.x guide: the way back', () => {
  it('names the folders 1.x wrote down, and never guesses -legacy', () => {
    expect(script).toContain('moved.json')
    expect(back).toContain('-legacy-2')
    expect(back).toContain('coordinator stop')
    expect(back).toContain('herdr plugin disable herdr-projects')
  })

  it('puts each folder back at its place, setting what is there aside, never inside it', () => {
    const at = setUp()
    run()
    expect(readFileSync(at('.herdr-projects/acme/PROJECT.md'), 'utf8')).toBe('# Acme\n')
    expect(existsSync(at('.herdr-projects/.herdr-projects-legacy-2'))).toBe(false)
    expect(existsSync(at('.config/herdr-projects/config.toml'))).toBe(true)
    expect(existsSync(at('.config/herdr-projects/herdr-projects-legacy'))).toBe(false)
    // 1.x's board and the folder made since: aside, under free names.
    expect(existsSync(at('.herdr-projects.from-1x-2/moved.json'))).toBe(true)
    expect(existsSync(at('.config/herdr-projects.from-1x-1/made-since'))).toBe(true)
    // Untouched: the older set-aside and the name that was already taken.
    expect(existsSync(at('.herdr-projects-legacy/older'))).toBe(true)
    expect(readdirSync(at('.herdr-projects.from-1x-1'))).toEqual([])
  })

  it('changes nothing when run a second time, and says nothing is wrong', () => {
    const at = setUp()
    run()
    const again = spawnSync('sh', ['-c', script], { env: { HOME: home, PATH: process.env.PATH }, encoding: 'utf8' })
    expect(again.status).toBe(0)
    expect(again.stderr).toBe('')
    const before = execFileSync('find', ['.'], { cwd: home, encoding: 'utf8' }).split('\n').sort()
    run()
    expect(execFileSync('find', ['.'], { cwd: home, encoding: 'utf8' }).split('\n').sort()).toEqual(before)
    expect(readFileSync(at('.herdr-projects/acme/PROJECT.md'), 'utf8')).toBe('# Acme\n')
  })
})

// Step 1 (backup) and step 5 of the way back (Herdr's config from that backup), run as written.
const blocks = (part: string) => [...part.matchAll(/```sh\n([\s\S]*?)```/g)].map(m => m[1]!.replace(/^ {5}|^ {3}/gm, ''))
const backUp = blocks(guide.slice(guide.indexOf('## 1. Back up'), guide.indexOf('## 2. Install'))).join('')
const restoreConfig = blocks(back).filter(b => b.includes('config.toml')).join('\n')

describe.skipIf(process.platform === 'win32')('herdr-projects 1.x guide: backup and Herdr config', () => {
  // A HOME with 0.2's files, and a `herdr` stand-in whose `config check` passes or fails.
  function setUpHome(check: 'pass' | 'fail') {
    home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-guide-'))
    const at = (p: string) => path.join(home, p)
    mkdirSync(at('.herdr-projects/acme'), { recursive: true })
    writeFileSync(at('.herdr-projects/acme/PROJECT.md'), '# Acme\n')
    mkdirSync(at('.config/herdr'), { recursive: true })
    writeFileSync(at('.config/herdr/config.toml'), '# 0.2 lines\n')
    mkdirSync(at('bin'))
    writeFileSync(at('bin/herdr'), `#!/bin/sh\n[ "$1 $2" = "config check" ] && exit ${check === 'pass' ? 0 : 1}\nexit 0\n`, { mode: 0o755 })
    return at
  }
  const sh = (code: string) => spawnSync('sh', ['-c', code], {
    env: { HOME: home, TMPDIR: home, PATH: `${path.join(home, 'bin')}:${process.env.PATH}` }, encoding: 'utf8',
  })

  it('makes one archive, records its path, and keeps the first one on a second run', () => {
    const at = setUpHome('pass')
    const first = sh(backUp)
    expect(first.stdout).toContain('backup ok:')
    const kept = readFileSync(at('herdr-projects-0.2-backup.path'), 'utf8').trim()
    expect(execFileSync('tar', ['tzf', kept], { encoding: 'utf8' })).toContain('.herdr-projects/acme/PROJECT.md')
    // 1.x changes the config, then the block runs again: the first backup stays the one recorded.
    writeFileSync(at('.config/herdr/config.toml'), '# 1.x lines\n')
    expect(sh(backUp).stdout).toContain('backup already made')
    expect(readFileSync(at('herdr-projects-0.2-backup.path'), 'utf8').trim()).toBe(kept)
  })

  it('restores Herdr\'s config from the backup and keeps the current file beside it', () => {
    const at = setUpHome('pass')
    sh(backUp)
    writeFileSync(at('.config/herdr/config.toml'), '# 1.x lines\n')
    expect(sh(restoreConfig).stdout).toContain('checked:')
    expect(readFileSync(at('.config/herdr/config.toml'), 'utf8')).toBe('# 0.2 lines\n')
    expect(readFileSync(at('.config/herdr/config.toml.before-0.2-restore'), 'utf8')).toBe('# 1.x lines\n')
  })

  it('replaces nothing when Herdr rejects the config from the backup', () => {
    const at = setUpHome('fail')
    sh(backUp)
    writeFileSync(at('.config/herdr/config.toml'), '# 1.x lines\n')
    expect(sh(restoreConfig).stdout).toContain('STOP: nothing restored')
    expect(readFileSync(at('.config/herdr/config.toml'), 'utf8')).toBe('# 1.x lines\n')
    expect(existsSync(at('.config/herdr/config.toml.before-0.2-restore'))).toBe(false)
  })

  it('goes back to wherdr 1.3.4 natively, with no Docker route', () => {
    const toWherdr134 = back.slice(back.indexOf('Go back to wherdr 1.3.4'), back.indexOf('## Moving from Docker'))
    expect(toWherdr134).toContain('WHERDR_REF=v1.3.4')
    expect(toWherdr134).not.toMatch(/docker/i)
  })
})
