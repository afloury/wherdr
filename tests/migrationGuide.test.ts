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
