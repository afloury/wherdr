// A folder macOS refuses to list (privacy protection on Documents, Desktop…)
// or that the account cannot read must not show as an empty folder. The
// scripts run locally with `ls` and `uname` replaced, to simulate a Mac.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIST_DIRS_SCRIPT, dirDeniedFromCode, dirDeniedFromError, parseDirList } from '../server/utils/fsx'
import { LIST_SCRIPT } from '../server/utils/files'

const base = mkdtempSync(path.join(tmpdir(), 'wherdr-denied-'))
const folder = path.join(base, 'Documents')
mkdirSync(path.join(folder, 'app', '.git'), { recursive: true })
mkdirSync(path.join(folder, 'notes'))
const empty = path.join(base, 'empty')
mkdirSync(empty)

// Shims: `ls` that fails with `lsError` (none: the real one), `uname` printing `os`.
function shims(os: string, lsError?: string) {
  const dir = mkdtempSync(path.join(base, 'bin-'))
  writeFileSync(path.join(dir, 'uname'), `#!/bin/sh\necho ${os}\n`)
  chmodSync(path.join(dir, 'uname'), 0o755)
  if (lsError) {
    writeFileSync(path.join(dir, 'ls'), `#!/bin/sh\necho "${lsError}" >&2\nexit 1\n`)
    chmodSync(path.join(dir, 'ls'), 0o755)
  }
  return dir
}

function run(script: string, args: string[], bin?: string) {
  const env = bin ? { ...process.env, PATH: `${bin}:${process.env.PATH}` } : process.env
  const r = spawnSync('sh', ['-c', script, 'sh', ...args], { env, encoding: 'utf8' })
  return { code: r.status, out: r.stdout }
}

describe('folder listing refused by the system', () => {
  it('lists subfolders, and an empty folder as empty (exit 0)', () => {
    const r = run(LIST_DIRS_SCRIPT, [folder])
    expect(r.code).toBe(0)
    expect(parseDirList(r.out).map(d => d.name).sort()).toEqual(['app', 'notes'])
    expect(run(LIST_DIRS_SCRIPT, [empty])).toEqual({ code: 0, out: '' })
  })

  it('exits 3 when macOS refuses the listing (cd works, ls is not permitted)', () => {
    const r = run(LIST_DIRS_SCRIPT, [folder], shims('Darwin', 'ls: .: Operation not permitted'))
    expect(r).toEqual({ code: 3, out: '' })
    expect(dirDeniedFromCode(r.code)).toBe('macos')
  })

  it('exits 2 for plain permission errors, and for EPERM outside macOS', () => {
    expect(run(LIST_DIRS_SCRIPT, [folder], shims('Darwin', 'ls: .: Permission denied')).code).toBe(2)
    expect(run(LIST_DIRS_SCRIPT, [folder], shims('Linux', 'ls: cannot open directory \'.\': Operation not permitted')).code).toBe(2)
    expect(dirDeniedFromCode(2)).toBe('permission')
  })

  it('still exits 1 for a missing folder (an error, not a refusal)', () => {
    const r = run(LIST_DIRS_SCRIPT, [path.join(base, 'missing')])
    expect(r.code).toBe(1)
    expect(dirDeniedFromCode(r.code)).toBeNull()
    expect(dirDeniedFromCode(0)).toBeNull()
  })

  it('maps local readdir errors (EPERM is macOS privacy protection on a Mac)', () => {
    const err = (code: string) => Object.assign(new Error(code), { code })
    expect(dirDeniedFromError(err('EPERM'), 'darwin')).toBe('macos')
    expect(dirDeniedFromError(err('EPERM'), 'linux')).toBe('permission')
    expect(dirDeniedFromError(err('EACCES'), 'darwin')).toBe('permission')
    expect(dirDeniedFromError(err('ENOENT'), 'darwin')).toBeNull()
    expect(dirDeniedFromError(null)).toBeNull()
  })

  it('Files window: exits 8 for macOS, 7 for plain rights, lists otherwise', () => {
    const args = [folder, '', '100']
    expect(run(LIST_SCRIPT, args).code).toBe(0)
    expect(run(LIST_SCRIPT, args, shims('Darwin', 'ls: .: Operation not permitted')).code).toBe(8)
    expect(run(LIST_SCRIPT, args, shims('Linux', 'ls: cannot open directory \'.\': Permission denied')).code).toBe(7)
  })
})
