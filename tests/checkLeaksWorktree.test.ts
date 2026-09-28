// Contrôle anti-fuite dans un worktree lié : motifs du checkout principal, avertissement sinon.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error module JS sans déclarations
import { findPatternsFile, mainCheckoutRoot } from '../scripts/check-leaks.mjs'

const script = path.resolve('scripts/check-leaks.mjs')
const dirs: string[] = []
// Sans les variables GIT_* d'un éventuel hook parent, qui viseraient le vrai dépôt.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' })

/** Dépôt jetable avec un commit et un worktree lié ; renvoie les deux racines. */
function repoWithWorktree() {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'leaks-wt-')))
  dirs.push(base)
  const main = path.join(base, 'main')
  const wt = path.join(base, 'wt')
  execFileSync('git', ['init', '-q', main], { env })
  git(main, 'config', 'user.email', 'test@example.invalid')
  git(main, 'config', 'user.name', 'Test')
  writeFileSync(path.join(main, '.gitignore'), '.leak-patterns\n')
  writeFileSync(path.join(main, 'a.txt'), 'hello forbidden-word\n')
  git(main, 'add', '.')
  git(main, 'commit', '-qm', 'init')
  git(main, 'worktree', 'add', '-q', wt)
  return { main, wt }
}

const run = (cwd: string) => spawnSync(process.execPath, [script], { cwd, env, encoding: 'utf8' })

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// Ces tests créent de vrais dépôts : ignorés là où git n'est pas installé (image node:22-alpine).
const hasGit = spawnSync('git', ['--version']).status === 0

describe.skipIf(!hasGit)('check-leaks dans un worktree', () => {
  it('trouve le checkout principal depuis un worktree lié, pas depuis le principal', () => {
    const { main, wt } = repoWithWorktree()
    expect(realpathSync(mainCheckoutRoot(wt))).toBe(main)
    expect(mainCheckoutRoot(main)).toBeNull()
  })

  it('utilise le .leak-patterns du checkout principal quand le worktree n\'en a pas', () => {
    const { main, wt } = repoWithWorktree()
    writeFileSync(path.join(main, '.leak-patterns'), 'forbidden-word\n')
    const found = findPatternsFile(wt)
    expect(found.from).toBe('main')
    expect(realpathSync(found.file)).toBe(path.join(main, '.leak-patterns'))

    const r = run(wt)
    expect(r.stdout).toContain('(main checkout)')
    expect(r.stdout).toContain('1 forbidden match')
    expect(r.status).toBe(1)
  })

  it('préfère le fichier du worktree quand il existe', () => {
    const { main, wt } = repoWithWorktree()
    writeFileSync(path.join(main, '.leak-patterns'), 'forbidden-word\n')
    writeFileSync(path.join(wt, '.leak-patterns'), 'other-word\n')
    expect(findPatternsFile(wt)).toEqual({ file: path.join(wt, '.leak-patterns'), from: 'checkout' })
  })

  it('avertit clairement quand aucun fichier de motifs n\'existe', () => {
    const { main, wt } = repoWithWorktree()
    const found = findPatternsFile(wt)
    expect(found.file).toBeNull()
    expect(found.tried.map((f: string) => realpathSync(path.dirname(f)))).toEqual([wt, main])

    const r = run(wt)
    expect(r.stderr).toContain('WARNING: no .leak-patterns file found')
    expect(r.stderr).toContain(path.join(main, '.leak-patterns'))
  })

  it('avertit quand le fichier de motifs ne contient aucun motif actif', () => {
    const { main, wt } = repoWithWorktree()
    writeFileSync(path.join(main, '.leak-patterns'), '# only comments\n\n')
    expect(run(wt).stderr).toContain('has no active pattern')
  })
})
