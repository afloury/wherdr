// Leak check over a commit range: lines added by each commit and commit messages.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error JS module without declarations
import { addedLines, parsePatterns, scanRange } from '../scripts/check-leaks.mjs'

const script = path.resolve('scripts/check-leaks.mjs')
const dirs: string[] = []
// Without the GIT_* variables of a possible parent hook, which would target the real repository.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' })

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Throwaway repository with one clean commit, tagged `base`. */
function repo() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'leaks-range-')))
  dirs.push(root)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'user.name', 'Test')
  writeFileSync(path.join(root, '.gitignore'), '.leak-patterns\n')
  writeFileSync(path.join(root, 'a.txt'), 'hello\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'init')
  git(root, 'tag', 'base')
  return root
}

function commit(root: string, files: Record<string, string | null>, message: string) {
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, file)
    if (text === null) unlinkSync(full)
    else { mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, text) }
  }
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', message)
}

const hasGit = spawnSync('git', ['--version']).status === 0

describe('addedLines', () => {
  it('keeps added lines with their new line numbers, not removed or deleted ones', () => {
    const patch = [
      'diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts',
      '@@ -2 +2,2 @@', '-old', '+new one', '+new two',
      'diff --git a/gone.ts b/gone.ts', '--- a/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye',
    ].join('\n')
    expect([...addedLines(patch)]).toEqual([['x.ts', [{ n: 2, text: 'new one' }, { n: 3, text: 'new two' }]]])
  })

  it('reads the combined diff of a merge: only lines added against every parent', () => {
    const patch = [
      'diff --cc m.ts', '+++ b/m.ts',
      '@@@ -1,2 -1,2 +1,3 @@@', '- theirs', ' -ours', '++resolved', '+ from first', '  same',
    ].join('\n')
    expect(addedLines(patch).get('m.ts')).toEqual([{ n: 1, text: 'resolved' }, { n: 2, text: 'from first' }])
  })

  it('decodes quoted paths', () => {
    const patch = ['+++ "b/caf\\303\\251 \\"x\\".txt"', '@@ -0,0 +1 @@', '+hi'].join('\n')
    expect([...addedLines(patch).keys()]).toEqual(['café "x".txt'])
  })
})

describe.skipIf(!hasGit)('check-leaks --range', () => {
  it('catches a leak added then removed in the range, with commit, file and line', () => {
    const root = repo()
    commit(root, { 'src/a.ts': 'one\nsecret-host here\n' }, 'add a')
    const leaky = git(root, 'rev-parse', '--short=9', 'HEAD').trim()
    commit(root, { 'src/a.ts': 'one\nclean\n' }, 'remove it')
    const { commits, hits } = scanRange(root, 'base..HEAD', parsePatterns('secret-host'))
    expect(commits).toBe(2)
    expect(hits).toEqual([{ commit: leaky, file: 'src/a.ts', line: 2, pattern: 'secret-host', excerpt: 'sec…(11 chars)' }])
  })

  it('ignores lines that are only removed and commits outside the range', () => {
    const root = repo()
    commit(root, { 'b.txt': 'secret-host\n' }, 'old leak')
    git(root, 'tag', 'published')
    commit(root, { 'b.txt': null }, 'drop it')
    expect(scanRange(root, 'published..HEAD', parsePatterns('secret-host')).hits).toEqual([])
  })

  it('honours per-file exceptions and ignored files', () => {
    const root = repo()
    commit(root, { 'LICENSE': 'Copyright alice\n', 'docs/x.md': 'alice\n', 'fixtures/f.json': 'alice\n' }, 'docs')
    const p = parsePatterns('alice !! LICENSE\n! fixtures/*.json\n')
    expect(scanRange(root, 'base..HEAD', p).hits.map((h: { file: string }) => h.file)).toEqual(['docs/x.md'])
  })

  it('scans commit messages with every rule, exceptions included', () => {
    const root = repo()
    commit(root, { 'LICENSE': 'MIT\n' }, 'Fix\n\nSeen on Secret-Host only')
    const p = parsePatterns('secret-host !! **\n')
    expect(scanRange(root, 'base..HEAD', p).hits).toEqual([
      { commit: expect.any(String), file: null, line: 3, pattern: 'secret-host', excerpt: 'Sec…(11 chars)' },
    ])
  })

  it('only reports what a merge itself adds, not what the merged commits brought', () => {
    const root = repo()
    git(root, 'checkout', '-qb', 'side')
    commit(root, { 'side.txt': 'secret-host\n' }, 'side')
    git(root, 'checkout', '-q', 'main')
    commit(root, { 'main.txt': 'ok\n' }, 'main')
    git(root, 'merge', '-q', '--no-edit', 'side')
    const hits = scanRange(root, 'base..HEAD', parsePatterns('secret-host')).hits
    expect(hits).toHaveLength(1)
    expect(hits[0].file).toBe('side.txt')
  })

  it('prints commit and location without the value and fails, from the command line', () => {
    const root = repo()
    writeFileSync(path.join(root, '.leak-patterns'), 'secret-host\n')
    commit(root, { 'a.txt': 'secret-host-value\n' }, 'leak')
    const r = spawnSync(process.execPath, [script, '--range', 'base..HEAD', '--no-gitleaks'], { cwd: root, env, encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/^[0-9a-f]{9} a\.txt:1 {2}sec…\(11 chars\) {2}\[secret-host\]$/m)
    expect(r.stdout).not.toContain('secret-host-value')
    const clean = spawnSync(process.execPath, [script, '--range', 'HEAD..HEAD', '--no-gitleaks'], { cwd: root, env, encoding: 'utf8' })
    expect(clean.status).toBe(0)
  })
})
