import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localShell } from './helpers/localShell'
import { CMD_FILES_SCRIPT, cmdFiles } from '../server/utils/commandCodeFiles'
import { parseCmdFiles } from '../server/utils/commandCodeFileRecords'
import { cmdProjectsRoot } from '../server/utils/commandCodeSessions'
import { shq, type ShellExec } from '../server/utils/fsx'

const U1 = '01234567-89ab-cdef-0123-456789abcdef'
const U2 = '11111111-2222-4333-8444-555555555555'
const U3 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

const roots: string[] = []
const mkhome = () => {
  const h = mkdtempSync(join(tmpdir(), 'cmdfiles-'))
  roots.push(h)
  return h
}
const rootOf = (home: string) => cmdProjectsRoot(home)
const put = (home: string, dir: string, name: string, body = '{}') => {
  const d = join(rootOf(home), dir)
  mkdirSync(d, { recursive: true })
  const f = join(d, name)
  writeFileSync(f, body)
  return f
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

const names = (files: { file: string }[]) => files.map(f => f.file).sort()

describe('commandCodeFiles producer', () => {
  it('reports a complete empty snapshot when the root is missing or empty', async () => {
    const home = mkhome()
    let s = await cmdFiles(localShell, home)
    expect(s).toMatchObject({ complete: true, files: [], dirs: 0, found: 0 })
    mkdirSync(rootOf(home), { recursive: true })
    s = await cmdFiles(localShell, home)
    expect(s).toMatchObject({ complete: true, files: [], dirs: 0, found: 0 })
  })

  it('rejects a root that is a file, a symlink or unreadable', async () => {
    const home = mkhome()
    mkdirSync(join(home, '.commandcode'), { recursive: true })
    writeFileSync(rootOf(home), 'x')
    expect((await cmdFiles(localShell, home)).incomplete).toBe('metadata')
    rmSync(rootOf(home))
    symlinkSync(home, rootOf(home))
    expect((await cmdFiles(localShell, home)).incomplete).toBe('metadata')
    rmSync(rootOf(home), { recursive: true })
    mkdirSync(rootOf(home), { mode: 0 })
    expect((await cmdFiles(localShell, home)).incomplete).toBe('metadata')
    chmodSync(rootOf(home), 0o755)
  })

  it('rejects a non-canonical root without running the script', async () => {
    const home = mkhome()
    let ran = false
    const exec: ShellExec = async (s, a, o) => { ran = true; return localShell(s, a, o) }
    const s = await cmdFiles(exec, home, { root: 'rel/dir/../x' })
    expect(s.incomplete).toBe('metadata')
    expect(ran).toBe(false)
  })

  it('lists uuid.jsonl files across project dirs with full stat metadata', async () => {
    const home = mkhome()
    const f1 = put(home, 'proj-a', `${U1}.jsonl`, '{"type":"session"}')
    const f2 = put(home, 'proj-b', `${U2}.jsonl`, 'x'.repeat(100))
    const s = await cmdFiles(localShell, home)
    expect(s.complete).toBe(true)
    expect(s.dirs).toBe(2)
    expect(s.found).toBe(2)
    expect(names(s.files)).toEqual([f1, f2].sort())
    const byFile = new Map(s.files.map(f => [f.file, f]))
    expect(byFile.get(f2)!.size).toBe(100)
    expect(byFile.get(f1)!.ino).toBe(statSync(f1).ino)
    expect(Math.abs(byFile.get(f1)!.mtimeMs - statSync(f1).mtimeMs)).toBeLessThan(1)
  })

  it('ignores sidecars, wrong depths, non-uuid names and posing directories', async () => {
    const home = mkhome()
    const good = put(home, 'proj', `${U1}.jsonl`)
    put(home, 'proj', `${U1}.checkpoints.jsonl`)
    put(home, 'proj', `${U1}.meta.json`)
    put(home, 'proj', 'not-a-uuid.jsonl')
    put(home, 'proj/sub', `${U2}.jsonl`) // depth 3: never enumerated
    writeFileSync(join(rootOf(home), `${U3}.jsonl`), 'x') // depth 1: not inside a project dir
    mkdirSync(join(rootOf(home), 'proj', `${U3}.jsonl`)) // directory posing as a file
    const s = await cmdFiles(localShell, home)
    expect(s.complete).toBe(true)
    expect(s.files).toEqual([expect.objectContaining({ file: good })])
    expect(s.found).toBe(3) // uuid + checkpoints + not-a-uuid are *.jsonl; seen, not candidates
  })

  it('round-trips newline, space, unicode and metachar project dir names', async () => {
    const home = mkhome()
    for (const dir of ['a b', 'uni-λ', 'with\nnewline', 'a$HOME`x`']) {
      put(home, dir, `${U1}.jsonl`)
    }
    const s = await cmdFiles(localShell, home)
    expect(s.complete).toBe(true)
    expect(s.dirs).toBe(4)
    expect(names(s.files)).toEqual([
      join(rootOf(home), 'a b', `${U1}.jsonl`),
      join(rootOf(home), 'uni-λ', `${U1}.jsonl`),
      join(rootOf(home), 'with\nnewline', `${U1}.jsonl`),
      join(rootOf(home), 'a$HOME`x`', `${U1}.jsonl`)
    ].sort())
  })

  it('is incomplete on symlink files/dirs, never follows them', async () => {
    const home = mkhome()
    const real = put(home, 'proj', `${U1}.jsonl`)
    symlinkSync(real, join(rootOf(home), 'proj', `${U2}.jsonl`))
    const outside = mkhome() // another synthetic home, stands in for an outside tree
    put(outside, 'sneaky', `${U3}.jsonl`)
    symlinkSync(join(rootOf(outside), 'sneaky'), join(rootOf(home), 'linked-dir'))
    const s = await cmdFiles(localShell, home)
    // Skipping them could pick an older regular session: excluded relevant
    // evidence makes the snapshot incomplete. Nothing is followed or read.
    expect(s.complete).toBe(false)
    expect(s.incomplete).toBe('metadata')
    expect(names(s.files)).toEqual([real])
  })

  it('is incomplete on a dangling root symlink, never a usable empty', async () => {
    const home = mkhome()
    mkdirSync(join(home, '.commandcode'), { recursive: true })
    symlinkSync(join(home, 'nowhere'), rootOf(home)) // target does not exist
    const s = await cmdFiles(localShell, home)
    expect(s.complete).toBe(false)
    expect(s.incomplete).toBe('metadata')
    expect(s.files).toEqual([])
  })

  it('is incomplete on an unreadable candidate even when stat succeeds', async () => {
    const home = mkhome()
    const locked = put(home, 'proj', `${U1}.jsonl`)
    put(home, 'proj', `${U2}.jsonl`)
    chmodSync(locked, 0) // stat still works; the file just can't be read
    const s = await cmdFiles(localShell, home)
    expect(s.complete).toBe(false)
    expect(s.incomplete).toBe('metadata')
    expect(names(s.files)).toEqual([join(rootOf(home), 'proj', `${U2}.jsonl`)])
    chmodSync(locked, 0o644)
  })

  it('marks a glob-listed file or dir that vanishes before its test as raced', async () => {
    const home = mkhome()
    put(home, 'p', `${U1}.jsonl`) // '0…' sorts first in the p dir
    put(home, 'p', `${U2}.jsonl`)
    put(home, 'q', `${U3}.jsonl`) // 'q' sorts after 'p'
    const bin = join(home, 'bin')
    mkdirSync(bin)
    // While stat'ing p's batch, delete U2's file and the whole q dir: both were
    // glob-listed already and must surface as raced, not be silently absent.
    writeFileSync(join(bin, 'stat'), `#!/bin/sh
for p in "$@"; do
  case "$p" in
    *${U1}*) rm -f "${rootOf(home)}/p/${U2}.jsonl"; rm -rf "${rootOf(home)}/q" ;;
  esac
done
exec /usr/bin/stat "$@"
`)
    chmodSync(join(bin, 'stat'), 0o755)
    const exec: ShellExec = (s, a, o) => localShell(`PATH=${bin}:$PATH\n` + s, a, o)
    const s = await cmdFiles(exec, home)
    expect(s.complete).toBe(false)
    expect(s.incomplete).toBe('raced')
  })

  it('is incomplete when a project dir is unreadable', async () => {
    const home = mkhome()
    put(home, 'proj', `${U1}.jsonl`)
    put(home, 'locked', `${U2}.jsonl`)
    chmodSync(join(rootOf(home), 'locked'), 0)
    const s = await cmdFiles(localShell, home)
    expect(s.complete).toBe(false)
    expect(s.incomplete).toBe('metadata')
    expect(names(s.files)).toEqual([join(rootOf(home), 'proj', `${U1}.jsonl`)])
    chmodSync(join(rootOf(home), 'locked'), 0o755)
  })

  it('reports a stat failure on a present file as incomplete metadata', async () => {
    const home = mkhome()
    put(home, 'proj', `${U1}.jsonl`)
    put(home, 'proj', `${U2}.jsonl`)
    const bin = join(home, 'bin')
    mkdirSync(bin)
    // One operand fails for good: the batch reports the rows it could read
    // and the snapshot is flagged — never a usable partial list.
    writeFileSync(join(bin, 'stat'), `#!/bin/sh
for p in "$@"; do
  case "$p" in
    *${U1}*) exit 1 ;;
  esac
done
exec /usr/bin/stat "$@"
`)
    chmodSync(join(bin, 'stat'), 0o755)
    const exec: ShellExec = (s, a, o) => localShell(`PATH=${bin}:$PATH\n` + s, a, o)
    const s = await cmdFiles(exec, home)
    expect(s.complete).toBe(false)
    expect(s.incomplete).toBe('metadata')
  })

  it('reports a listed file that vanishes before stat as raced', async () => {
    const home = mkhome()
    put(home, 'proj', `${U1}.jsonl`)
    put(home, 'proj', `${U2}.jsonl`)
    const bin = join(home, 'bin')
    mkdirSync(bin)
    // The shim deletes the file then fails: the retry sees it gone → raced.
    writeFileSync(join(bin, 'stat'), `#!/bin/sh
for p in "$@"; do
  case "$p" in
    *${U2}*) rm -f "$p"; exit 1 ;;
  esac
done
exec /usr/bin/stat "$@"
`)
    chmodSync(join(bin, 'stat'), 0o755)
    const exec: ShellExec = (s, a, o) => localShell(`PATH=${bin}:$PATH\n` + s, a, o)
    const s = await cmdFiles(exec, home)
    expect(s.complete).toBe(false)
    expect(s.incomplete).toBe('raced')
    expect(readdirSync(join(rootOf(home), 'proj'))).not.toContain(`${U2}.jsonl`)
  })

  it('is incomplete when the file cap is exhausted, never a truncated list', async () => {
    const home = mkhome()
    put(home, 'p', `${U1}.jsonl`)
    put(home, 'p', `${U2}.jsonl`)
    put(home, 'q', `${U3}.jsonl`)
    const s = await cmdFiles(localShell, home, { maxFiles: 2 })
    expect(s.complete).toBe(false)
    expect(s.incomplete).toBe('oversize')
  })

  it('reports unavailable when the exec itself fails', async () => {
    const home = mkhome()
    const exec: ShellExec = async () => ({ code: 1, stdout: Buffer.alloc(0), stderr: 'boom' })
    expect((await cmdFiles(exec, home)).incomplete).toBe('unavailable')
  })

  it('passes the root positionally and matches localShell results (remote parity)', async () => {
    const home = mkhome()
    put(home, 'proj', `${U1}.jsonl`)
    let seen: string[] = []
    const exec: ShellExec = async (s, a, o) => { seen = a || []; return localShell(s, a, o) }
    const [a, b] = await Promise.all([cmdFiles(exec, home), cmdFiles(localShell, home)])
    expect(seen[0]).toBe(rootOf(home))
    expect(names(a.files)).toEqual(names(b.files))
    expect(a.complete).toBe(b.complete)
    expect(CMD_FILES_SCRIPT).not.toContain(rootOf(home)) // never interpolated into code
  })

  it('runs one stat and one base64 per directory, whatever the file count', async () => {
    // The shape the review asked for: a project with many transcripts must
    // not fork per file. Every command the script runs is recorded through a
    // PATH shim that logs its own name, then execs the real one.
    const dirs = ['p', 'q', 'r']
    const run = async (perDir: number) => {
      const home = mkhome()
      for (const d of dirs) {
        for (let i = 0; i < perDir; i++) {
          put(home, d, `${String(i).padStart(8, '0')}-1111-4222-8333-444444444444.jsonl`)
        }
      }
      const bin = join(home, 'logbin')
      mkdirSync(bin)
      const log = join(home, 'calls.log')
      const real = (name: string) => ['/usr/bin', '/bin'].map(d => join(d, name)).find(p => existsSync(p))
      for (const name of ['stat', 'base64', 'tr', 'grep', 'printf', 'od', 'head', 'find']) {
        const target = real(name)
        if (!target) continue
        writeFileSync(join(bin, name), `#!/bin/sh
echo ${name} >> ${shq(log)}
exec ${target} "$@"
`)
        chmodSync(join(bin, name), 0o755)
      }
      const exec: ShellExec = (s, a, o) => localShell(`PATH=${shq(bin)}:$PATH\n` + s, a, o)
      const s = await cmdFiles(exec, home)
      expect(s.complete).toBe(true)
      expect(s.files.length).toBe(dirs.length * perDir)
      const calls = readFileSync(log, 'utf8').trim().split('\n')
      return {
        stat: calls.filter(c => c === 'stat').length,
        base64: calls.filter(c => c === 'base64').length,
      }
    }
    const few = await run(2)
    const many = await run(40)
    // The per-file work is unchanged by the file count: 120 transcripts cost
    // the same forks as 6. One `base64` (plus its one-shot capability probe)
    // and one `stat` per directory, never per file.
    expect(many.stat).toBe(few.stat)
    expect(many.base64).toBe(few.base64)
    expect(few.stat).toBeLessThanOrEqual(dirs.length + 1)
    expect(few.base64).toBeLessThanOrEqual(2)
  })

  it('caches a complete listing between windows while it is unchanged', async () => {
    const home = mkhome()
    const f = put(home, 'proj', `${U1}.jsonl`)
    let runs = 0
    const exec: ShellExec = async (s, a, o) => { runs++; return localShell(s, a, o) }
    const first = await cmdFiles(exec, home)
    expect(first.complete).toBe(true)
    expect(runs).toBe(1)
    // Unchanged: the same immutable snapshot comes back, and the listing is
    // still asked (the mtime witness is the caller's), but decoding reuses it.
    const again = await cmdFiles(exec, home)
    expect(again).toBe(first)
    expect(runs).toBe(2)
    // A real change makes the next snapshot different.
    utimesSync(f, 1_700_000_000, 1_700_000_000)
    const changed = await cmdFiles(exec, home)
    expect(changed).not.toBe(first)
    expect(changed.files[0]!.mtimeMs).toBe(1_700_000_000_000)
  })

  it('never caches an incomplete listing', async () => {
    const home = mkhome()
    const locked = put(home, 'proj', `${U1}.jsonl`)
    chmodSync(locked, 0)
    let runs = 0
    const exec: ShellExec = async (s, a, o) => { runs++; return localShell(s, a, o) }
    const first = await cmdFiles(exec, home)
    expect(first.incomplete).toBe('metadata')
    const again = await cmdFiles(exec, home)
    expect(again).not.toBe(first) // a raced/unreadable listing is re-observed
    expect(again.complete).toBe(false)
    expect(runs).toBe(2)
    chmodSync(locked, 0o644)
  })
})

describe('glob literals and counted caps', () => {
  it('scans project dirs literally named like the glob patterns', async () => {
    const home = mkhome()
    // These names expand to strings identical to the unmatched-literal
    // patterns: equality alone must not skip a dir that actually exists.
    // '.!x' is the control — it never equals a literal and always scanned.
    for (const dir of ['*', '.[!.]*', '.!x']) put(home, dir, `${U1}.jsonl`)
    const s = await cmdFiles(localShell, home)
    expect(s.complete).toBe(true)
    expect(s.dirs).toBe(3)
    expect(names(s.files)).toEqual([
      join(rootOf(home), '*', `${U1}.jsonl`),
      join(rootOf(home), '.[!.]*', `${U1}.jsonl`),
      join(rootOf(home), '.!x', `${U1}.jsonl`)
    ].sort())
  })

  it('accepts project dirs whose names start with ..', async () => {
    const home = mkhome()
    // '..x'/'..?*' are ordinary names, not traversal: rel starts with the
    // two characters '..' but the segment is not '..'.
    for (const dir of ['..x', '..?*']) put(home, dir, `${U1}.jsonl`)
    const s = await cmdFiles(localShell, home)
    expect(s.complete).toBe(true)
    expect(s.dirs).toBe(2)
    expect(names(s.files)).toEqual([
      join(rootOf(home), '..x', `${U1}.jsonl`),
      join(rootOf(home), '..?*', `${U1}.jsonl`)
    ].sort())
  })

  it('counts a file literally named *.jsonl instead of skipping it as a literal', async () => {
    const home = mkhome()
    const good = put(home, 'proj', `${U1}.jsonl`)
    put(home, 'proj', '*.jsonl') // real file whose path equals the literal pattern
    const s = await cmdFiles(localShell, home)
    expect(s.complete).toBe(true)
    expect(s.found).toBe(2) // counted as found, skipped as a non-uuid sidecar
    expect(names(s.files)).toEqual([good])
  })

  it('applies the dir and file caps to flagged entries, not only scanned ones', async () => {
    const home = mkhome()
    // Two symlink dirs + one real dir, maxDirs=2: flagged entries spend from
    // the same budget — p and q are counted (dirs=3 when r trips the cap)
    // instead of slipping past uncounted (dirs=1, unbounded scan). Bit 1
    // dominates the reason, so it reports metadata either way.
    const target = mkhome()
    put(target, 'x', `${U1}.jsonl`)
    mkdirSync(rootOf(home), { recursive: true })
    for (const d of ['p', 'q']) symlinkSync(join(rootOf(target), 'x'), join(rootOf(home), d))
    put(home, 'r', `${U2}.jsonl`)
    let s = await cmdFiles(localShell, home, { maxDirs: 2 })
    expect(s.incomplete).toBe('metadata')
    expect(s.dirs).toBe(3)
    // Same for files: the third symlink spends the last of maxf — found=3
    // (each counted, capped, early exit) instead of found=1.
    const home2 = mkhome()
    const real = put(home2, 'ext', `${U3}.jsonl`)
    mkdirSync(join(rootOf(home2), 'proj'), { recursive: true })
    for (const id of [U1, U2, '22222222-3333-4444-8555-666666666666']) {
      symlinkSync(real, join(rootOf(home2), 'proj', `${id}.jsonl`))
    }
    s = await cmdFiles(localShell, home2, { maxFiles: 2 })
    expect(s.incomplete).toBe('metadata')
    expect(s.found).toBe(3)
  })

})

describe('parseCmdFiles', () => {
  const ROOT = '/home/user/.commandcode/projects'
  const rec = (file: string, stat = '7 1700000000.123456789 42 regular file') => `${file}\u0000${stat}\u0000`
  const f = (id: string, dir = 'proj') => `${ROOT}/${dir}/${id}.jsonl`
  const foot = (n = 0, found = 0, r = 0, o = 0) => `T\u0000${n}\u0000${found}\u0000${r}\u0000${o}\u0000`
  it('parses an empty and a populated snapshot', () => {
    expect(parseCmdFiles(ROOT, `H\u0000${foot()}`)).toMatchObject({ complete: true, files: [], dirs: 0, found: 0 })
    const proj = `${ROOT}/proj`
    const s = parseCmdFiles(ROOT, `H\u0000${rec(proj, '4096 1700000000.5 7 directory')}${rec(f(U1))}${rec(f(U2, 'x y\nz'))}${foot(1, 2, 2)}`)
    expect(s.complete).toBe(true)
    expect(s.files.map(x => x.file)).toEqual([f(U1), f(U2, 'x y\nz')])
    expect(s.files[0]).toMatchObject({ ino: 42, size: 7, mtimeMs: 1700000000123.456 })
    expect(s.dirs).toBe(1)
    expect(s.found).toBe(2)
  })

  it('preserves legitimate empty project dirs', () => {
    const a = rec(`${ROOT}/a`, '4096 1700000000.5 3 directory')
    const b = rec(`${ROOT}/b`, '4096 1700000000.5 4 directory')
    expect(parseCmdFiles(ROOT, `H\u0000${a}${b}${foot(2, 0, 0)}`)).toMatchObject({ complete: true, files: [], dirs: 2, found: 0 })
  })

  it('skips sidecar shapes silently while counting them as found', () => {
    const proj = rec(`${ROOT}/proj`, '4096 1700000000.5 7 directory')
    const out = `H\u0000${proj}${rec(f(U1))}${rec(f('not-a-uuid'))}${rec(`${ROOT}/proj/${U1}.checkpoints.jsonl`)}${foot(1, 3, 3)}`
    const s = parseCmdFiles(ROOT, out)
    expect(s.complete).toBe(true)
    expect(s.files.map(x => x.file)).toEqual([f(U1)])
    expect(s.found).toBe(3)
  })

  it('rejects malformed framing, order, counts and records', () => {
    const good = rec(f(U1))
    expect(parseCmdFiles(ROOT, `R\u0000${good}`).incomplete).toBe('truncated')            // H not first
    expect(parseCmdFiles(ROOT, `H\u0000${good}`).incomplete).toBe('truncated')            // missing footer
    expect(parseCmdFiles(ROOT, `H\u0000${foot()}${good}`).incomplete).toBe('truncated')   // footer not last
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot()}${foot()}`).incomplete).toBe('truncated')
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot(1, 1, 1)}`).incomplete).toBe('truncated') // r != records
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot(1, 0, 1)}`).incomplete).toBe('truncated') // f < r
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot(0, 1, 1)}`).incomplete).toBe('truncated') // record with 0 dirs
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot(1, 1, 1, 16)}`).incomplete).toBe('truncated') // unknown flag bits
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot(1, 1, 1)}`).incomplete).toBe('truncated') // missing footer count
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot(1, 1, 1, 16)}`).incomplete).toBe('truncated')
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1), 'x'.repeat(70000))}${foot(1, 1, 1)}`).incomplete).toBe('oversize') // giant stat line
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1), 'garbage')}${foot(1, 1, 1)}`).incomplete).toBe('truncated')
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1), '7 1700000000 x directory')}${foot(1, 1, 1)}`).incomplete).toBe('truncated')
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1), '7 1700000000.1 regular file')}${foot(1, 1, 1)}`).incomplete).toBe('truncated') // no ino
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1), `7 1700000000 ${'9'.repeat(400)} regular file`)}${foot(1, 1, 1)}`).incomplete).toBe('truncated') // unsafe ino
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1), '7 1700000000 0 regular file')}${foot(1, 1, 1)}`).incomplete).toBe('truncated') // ino 0
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1), '-5 1700000000 42 regular file')}${foot(1, 1, 1)}`).incomplete).toBe('truncated') // negative size
  })

  it('rejects impossible counts, wrapped flags and unsafe stat values', () => {
    const good = rec(f(U1))
    // flags=0 means nothing was dropped: a found file with no record is corrupt.
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot(1, 2, 1, 0)}`).incomplete).toBe('truncated') // f > r, flags=0
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot(1, 1, 1, 4294967296)}`).incomplete).toBe('truncated') // wraps past int32 &
    expect(parseCmdFiles(ROOT, `H\u0000${good}${foot(2000000, 1, 1, 0)}`).incomplete).toBe('truncated') // safe but absurd counter
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1), '9007199254740993 1700000000 42 regular file')}${foot(1, 1, 1, 0)}`).incomplete).toBe('truncated') // unsafe size
  })

  it('rejects malformed wire paths and duplicate records', () => {
    const good = rec(f(U1))
    // Confined but wrong depth / outside-root / non-canonical paths are not
    // sidecars: the producer never emits them, so they are wire corruption.
    expect(parseCmdFiles(ROOT, `H\u0000${rec(`${ROOT}/deep/a/b.jsonl`)}${foot(1, 1, 1)}`).incomplete).toBe('truncated')
    expect(parseCmdFiles(ROOT, `H\u0000${rec(`/etc/${U1}.jsonl`)}${foot(1, 1, 1)}`).incomplete).toBe('truncated')
    expect(parseCmdFiles(ROOT, `H\u0000${rec(`${ROOT}/proj/../x/${U1}.jsonl`)}${foot(1, 1, 1)}`).incomplete).toBe('truncated')
    expect(parseCmdFiles(ROOT, `H\u0000!!!\u00007 1700000000 42 regular file\u0000${foot(1, 1, 1)}`).incomplete).toBe('truncated')
    expect(parseCmdFiles(ROOT, `H\u0000${good}${good}${foot(1, 2, 2)}`).incomplete).toBe('truncated') // duplicate file
  })

  it('reaches a producer row only through NUL framing, never an embedded newline', () => {
    // A path carrying a newline is just data inside its frame.
    const weird = `${ROOT}/x y\nz/${U1}.jsonl`
    const dir = rec(`${ROOT}/x y\nz`, '4096 1700000000.5 3 directory')
    const s = parseCmdFiles(ROOT, `H\u0000${dir}${rec(weird)}${foot(1, 1, 1)}`)
    expect(s.complete).toBe(true)
    expect(s.files.map(x => x.file)).toEqual([weird])
    // An invalid UTF-8 path byte decodes to U+FFFD and no longer round-trips:
    // the canonical shape check rejects it.
    const badBytes = Buffer.concat([Buffer.from(`H\u0000${ROOT}/proj/`), Buffer.from([0xff]), Buffer.from(`/${U2}.jsonl\u00007 1700000000 42 regular file\u0000${foot(0, 1, 1)}`)])
    expect(parseCmdFiles(ROOT, badBytes).incomplete).toBe('truncated')
    // A real U+FFFD still round-trips and stays a valid (non-uuid) sidecar.
    const uffd = `${ROOT}/proj/we\ufffddir.jsonl`
    expect(parseCmdFiles(ROOT, `H\u0000${rec(uffd)}${foot(0, 1, 1)}`).files).toEqual([])
  })

  it('applies byte-length total, line and record bounds before allocating', () => {
    expect(parseCmdFiles(ROOT, 'x'.repeat(4 * 1024 * 1024 + 1)).incomplete).toBe('oversize')
    expect(parseCmdFiles(ROOT, 'λ'.repeat(2_100_000)).incomplete).toBe('oversize') // 2.1M chars, 4.2M bytes
    expect(parseCmdFiles(ROOT, `H\u0000${f(U1)}\u0000${'x'.repeat(70000)}\u0000${foot(1, 1, 1)}`).incomplete).toBe('oversize')
    const many = Array.from({ length: 8200 }, (_, i) => rec(f(U1, `d${i}`))).join('')
    expect(parseCmdFiles(ROOT, `H\u0000${many}${foot(8200, 8200, 8200)}`).incomplete).toBe('oversize')
  })

  it('maps footer flags to incomplete reasons', () => {
    const tail = (o: number) => foot(1, 1, 1, o)
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1))}${tail(1)}`)).toMatchObject({ complete: false, incomplete: 'metadata' })
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1))}${tail(2)}`)).toMatchObject({ complete: false, incomplete: 'raced' })
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1))}${tail(4)}`)).toMatchObject({ complete: false, incomplete: 'oversize' })
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1))}${tail(8)}`)).toMatchObject({ complete: false, incomplete: 'oversize' })
    // With a nonzero flag, a found-but-dropped row is explained, not corrupt.
    expect(parseCmdFiles(ROOT, `H\u0000${rec(f(U1))}${foot(1, 2, 2, 1)}`)).toMatchObject({ complete: false, incomplete: 'metadata' })
  })

  it('rejects a non-canonical root before decoding', () => {
    expect(parseCmdFiles(`${ROOT}/../x`, `H\u0000${rec(f(U1))}${foot(1, 1, 1)}`).incomplete).toBe('metadata')
  })
})
