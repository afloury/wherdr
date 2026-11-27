import { appendFileSync, chmodSync, mkdirSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localShell } from './helpers/localShell'
import { cmdFiles } from '../server/utils/commandCodeFiles'
import { createCmdHeaders } from '../server/utils/commandCodeHeaders'
import { CMD_HEADERS_SCRIPT, parseCmdHeaders } from '../server/utils/commandCodeHeaderRecords'
import type { CmdFileSnapshot } from '../server/utils/commandCodeFileRecords'
import type { ShellExec } from '../server/utils/fsx'
import { U1, U2, U3, cleanupHomes, counting, hdr, mkhome, put, putSess, rootOf } from './cmdHeaderFixture'

afterEach(cleanupHomes)

const snap = async (home: string) => cmdFiles(localShell, home)
const count = () => counting(localShell)

describe('createCmdHeaders', () => {
  it('reads validated headers for every candidate, large bodies bounded', async () => {
    const home = mkhome()
    const f1 = putSess(home, 'p', U1, '/work/one')
    putSess(home, 'q', U2, '/work/two', 'x'.repeat(3 * 1024 * 1024)) // multi-MB body, first line only
    const c = count()
    const h = createCmdHeaders(c.exec, home)
    const r = await h.headers(await snap(home))
    expect(r.complete).toBe(true)
    expect(r.items.map(i => i.file).sort()).toEqual([f1, join(rootOf(home), 'q', `${U2}.jsonl`)].sort())
    expect(r.items.find(i => i.file === f1)).toMatchObject({ id: U1, cwd: '/work/one' })
    expect(c.seen.length).toBe(1) // one batch round trip
    // A warm unchanged poll transfers zero header bytes: no exec at all.
    const r2 = await h.headers(await snap(home))
    expect(r2.complete).toBe(true)
    expect(r2.items.length).toBe(2)
    expect(c.seen.length).toBe(1)
  })

  it('is incomplete on malformed, wrong-shape or mismatched headers', async () => {
    const home = mkhome()
    putSess(home, 'ok', U1)
    put(home, 'bad', `${U2}.jsonl`, 'not json\n')
    put(home, 'ver', `${U3}.jsonl`, JSON.stringify({ type: 'session', version: 2, id: U3, cwd: '/x' }) + '\n')
    let r = await createCmdHeaders(localShell, home).headers(await snap(home))
    expect(r.complete).toBe(false)
    expect(r.incomplete).toBe('metadata')
    expect(r.items.map(i => i.id)).toEqual([U1]) // good entries still returned
    // id in the header disagreeing with the basename is just as malformed.
    const home2 = mkhome()
    put(home2, 'p', `${U1}.jsonl`, hdr(U2) + 'x\n')
    r = await createCmdHeaders(localShell, home2).headers(await snap(home2))
    expect(r.incomplete).toBe('metadata')
    // relative cwd and an overlong first line fail the same way.
    const home3 = mkhome()
    put(home3, 'p', `${U1}.jsonl`, hdr(U1, 'relative/cwd') + 'x\n')
    put(home3, 'p', `${U2}.jsonl`, `{"type":"session","version":3,"id":"${U2}","cwd":"/${'x'.repeat(20000)}"}\n`)
    r = await createCmdHeaders(localShell, home3).headers(await snap(home3))
    expect(r.incomplete).toBe('metadata')
    expect(r.items).toEqual([])
  })

  it('propagates an incomplete producer snapshot without re-reading', async () => {
    const home = mkhome()
    // The real metadata producer already flags an unreadable file — that flag
    // must reach the result, never be quietly re-read.
    const locked = putSess(home, 'p', U1)
    chmodSync(locked, 0)
    const c = count()
    const r = await createCmdHeaders(c.exec, home).headers(await snap(home))
    expect(r.complete).toBe(false)
    expect(r.incomplete).toBe('metadata')
    expect(c.seen.length).toBe(0) // no header RPC on an incomplete snapshot
    chmodSync(locked, 0o644)
  })

  it('reports a listing-meta vs observed-stat mismatch as raced', async () => {
    const home = mkhome()
    const f = putSess(home, 'p', U1)
    const s = await snap(home)
    appendFileSync(f, 'more\n') // mtime/size changed after the listing
    const r = await createCmdHeaders(localShell, home).headers(s)
    expect(r.incomplete).toBe('raced')
    expect(r.items).toEqual([]) // never a mixed header/stat candidate
  })

  it('rejects unsafe snapshot metadata even when the record would be pre-birth', async () => {
    const home = mkhome()
    const f = `${rootOf(home)}/p/${U1}.jsonl`
    const snapOf = (over: object): CmdFileSnapshot => ({ complete: true, files: [{ file: f, ino: 7, size: 9, mtimeMs: 1, ...over }], dirs: 1, found: 1 })
    // Every record is validated BEFORE afterMs/cache: malformed numeric
    // metadata can never hide a candidate behind a "pre-birth" filter.
    for (const bad of [
      snapOf({ mtimeMs: Number.NaN }),
      snapOf({ mtimeMs: Number.POSITIVE_INFINITY }),
      snapOf({ ino: 0 }),
      snapOf({ ino: -1 }),
      snapOf({ ino: Number.NaN }),
      snapOf({ size: -1 }),
      snapOf({ size: Number.NaN }),
      snapOf({ size: 9007199254740993 }) // 2^53+1 rounds — not a safe integer
    ]) {
      const r = await createCmdHeaders(localShell, home).headers(bad, { afterMs: 0 })
      expect(r.complete).toBe(false)
      expect(r.incomplete).toBe('metadata')
    }
  })

  it('rejects header lines that are not exact UTF-8', async () => {
    const home = mkhome()
    // A raw 0xFF byte inside cwd must not decode to '/work/�' and be used.
    const bad = Buffer.concat([
      Buffer.from(`{"type":"session","version":3,"id":"${U1}","cwd":"/work/`),
      Buffer.from([0xff]),
      Buffer.from('"}\nbody\n')
    ])
    put(home, 'p', `${U1}.jsonl`, bad)
    const r = await createCmdHeaders(localShell, home).headers(await snap(home))
    expect(r.complete).toBe(false)
    expect(r.incomplete).toBe('metadata')
    // A REAL U+FFFD (EF BF BD) and other unicode are valid UTF-8: keep them.
    const home2 = mkhome()
    putSess(home2, 'p', U1, '/work/λ�x')
    const r2 = await createCmdHeaders(localShell, home2).headers(await snap(home2))
    expect(r2.complete).toBe(true)
    expect(r2.items[0]?.cwd).toBe('/work/λ�x')
  })

  it('skips pre-birth header reads but keeps every basename for seeds', async () => {
    const home = mkhome()
    const old = putSess(home, 'old', U2)
    const fresh = putSess(home, 'new', U1)
    utimesSync(old, 1_000_000_000, 1_000_000_000)
    utimesSync(fresh, 1_700_000_000, 1_700_000_000)
    const s = await snap(home)
    const c = count()
    const r = await createCmdHeaders(c.exec, home).headers(s, { afterMs: 1_500_000_000_000 })
    expect(r.complete).toBe(true)
    expect(r.items.map(i => i.id)).toEqual([U1]) // only post-birth got a header read
    expect(r.files.map(f => f.id).sort()).toEqual([U1, U2].sort()) // all basenames preserved
    expect(c.seen[0]?.slice(1)).toEqual([fresh]) // the pre-birth path was never read
  })

  it('keeps duplicate basenames visible when one is pre-birth and malformed', async () => {
    const home = mkhome()
    // A --session <uuid> seed is unique only across ALL files: hiding the
    // pre-birth duplicate (or failing on its unread header) would falsely
    // accept the seed. Pre-birth entries never reach a header read at all.
    const a = putSess(home, 'd1', U1)
    const b = put(home, 'd2', `${U1}.jsonl`, 'not a header\n')
    utimesSync(a, 1_700_000_000, 1_700_000_000)
    utimesSync(b, 1_000_000_000, 1_000_000_000)
    const r = await createCmdHeaders(localShell, home).headers(await snap(home), { afterMs: 1_500_000_000_000 })
    expect(r.complete).toBe(true)
    expect(r.items.map(i => i.id)).toEqual([U1])
    expect(r.files.filter(f => f.id === U1).length).toBe(2) // ambiguity survives
  })

  it('stays incomplete on an incomplete snapshot but ships the catalog', async () => {
    const home = mkhome()
    const f = `${rootOf(home)}/p/${U1}.jsonl`
    const s: CmdFileSnapshot = { complete: false, incomplete: 'raced', files: [{ file: f, ino: 7, size: 9, mtimeMs: 1 }], dirs: 0, found: 0 }
    const r = await createCmdHeaders(localShell, home).headers(s)
    expect(r.complete).toBe(false)
    expect(r.incomplete).toBe('raced')
    expect(r.items).toEqual([])
    expect(r.files).toEqual([{ file: f, id: U1 }])
    expect((await createCmdHeaders(localShell, home).headers(s, { afterMs: Number.NaN })).incomplete).toBe('metadata')
    // An empty complete snapshot completes with an empty catalog, no exec.
    const c = count()
    const empty = await createCmdHeaders(c.exec, mkhome()).headers(await snap(mkhome()))
    expect(empty).toMatchObject({ complete: true, items: [], files: [] })
    expect(c.seen.length).toBe(0)
  })

  it('re-reads changed or replaced files and retries failed reads', async () => {
    const home = mkhome()
    const f = putSess(home, 'p', U1)
    const c = count()
    const h = createCmdHeaders(c.exec, home)
    expect((await h.headers(await snap(home))).complete).toBe(true)
    expect(c.seen.length).toBe(1)
    appendFileSync(f, 'more events\n') // changed: stat triple differs -> re-read
    expect((await h.headers(await snap(home))).complete).toBe(true)
    expect(c.seen.length).toBe(2)
    unlinkSync(f)
    writeFileSync(f, hdr(U2) + 'x\n') // replaced: new inode AND new header id
    const s = await snap(home)
    const r = await h.headers(s)
    expect(r.complete).toBe(false) // basename id U1 != header id U2: metadata
    expect(r.incomplete).toBe('metadata')
    // A failed read is never cached as success: fix and it recovers.
    writeFileSync(f, hdr(U1) + 'x\n')
    const r2 = await h.headers(await snap(home))
    expect(r2.complete).toBe(true)
    expect(r2.items.map(i => i.id)).toEqual([U1])
  })

  it('evicts within a bounded cache without losing current-pass candidates', async () => {
    const home = mkhome()
    putSess(home, 'p', U1)
    putSess(home, 'p', U2)
    putSess(home, 'p', U3)
    const h = createCmdHeaders(localShell, home, { cacheEntries: 1 }) // smaller than the snapshot
    for (let i = 0; i < 3; i++) {
      const r = await h.headers(await snap(home))
      expect(r.complete).toBe(true)
      expect(r.items.length).toBe(3) // eviction forces re-reads, never drops items
    }
  })

  it('coalesces concurrent calls and bounds the pending queue', async () => {
    const home = mkhome()
    putSess(home, 'p', U1)
    const c = count()
    const h = createCmdHeaders(c.exec, home)
    const s = await snap(home)
    const [a, b] = await Promise.all([h.headers(s), h.headers(s)])
    expect(a.complete).toBe(true)
    expect(b.complete).toBe(true)
    expect(c.seen.length).toBe(1) // serialized: the second call sees a warm cache
    // Identical in-flight calls share work BEFORE pending accounting: with
    // maxPending=1 both resolve COMPLETE on one exec — serial queue plus
    // rejection is not coalescing. Distinct requests still hit the cap.
    let release: () => void = () => {}
    const gate = new Promise<void>(res => { release = res })
    const c2 = count()
    const slow: ShellExec = async (s2, a, o) => { await gate; return c2.exec(s2, a, o) }
    const h2 = createCmdHeaders(slow, home, { maxPending: 1 })
    const g1 = h2.headers(s)
    const g2 = h2.headers(s) // identical: shares g1, spends no pending slot
    const overAfter = await h2.headers(s, { afterMs: 42 }) // distinct afterMs -> cap
    const overSnap = await h2.headers({ ...s }) // distinct snapshot -> cap
    expect(overAfter.incomplete).toBe('unavailable')
    expect(overSnap.incomplete).toBe('unavailable')
    release()
    const [r1, r2] = await Promise.all([g1, g2])
    expect(r1).toBe(r2) // literally the same shared resolution
    expect(r1.complete).toBe(true)
    expect(r1.items.length).toBe(1)
    expect(c2.seen.length).toBe(1) // one exec for both callers
    // Once resolved the key is forgotten: the next identical call gets a
    // fresh run (warm cache legitimately needs no exec for it).
    const r3 = await h2.headers(s)
    expect(r3).not.toBe(r1)
    expect(r3.complete).toBe(true)
    expect(c2.seen.length).toBe(1)
    // A shared in-flight failure resolves identically for every sharer.
    const boom: ShellExec = async () => { throw new Error('x') }
    const h3 = createCmdHeaders(boom, home, { maxPending: 1 })
    const [f1, f2] = await Promise.all([h3.headers(s), h3.headers(s)])
    expect(f1).toBe(f2)
    expect(f1.incomplete).toBe('unavailable')
  })

  it('aborts instead of issuing an empty batch for an oversized path', async () => {
    const home = mkhome()
    // One path bigger than the whole request budget: chunk assembly must
    // fail, never loop zero-progress RPCs. (Timeout would reveal a hang.)
    const huge = `${rootOf(home)}/${'x'.repeat(300000)}/${U1}.jsonl`
    const s: CmdFileSnapshot = { complete: true, files: [{ file: huge, ino: 1, size: 1, mtimeMs: 1 }], dirs: 1, found: 1 }
    const r = await createCmdHeaders(localShell, home).headers(s)
    expect(r.complete).toBe(false)
    expect(r.incomplete).toBe('metadata')
  }, 2000)

  it('clamps cache and pending options to finite positive bounds', async () => {
    const home = mkhome()
    putSess(home, 'p', U1)
    const s = await snap(home)
    // maxPending: 0 would refuse every call; a clamped bound keeps working.
    const h = createCmdHeaders(localShell, home, { maxPending: 0 })
    expect((await h.headers(s)).complete).toBe(true)
    // cacheEntries: 0 evicts every entry at insert: a warm poll must not
    // re-read, so the clamped bound keeps its minimum capacity.
    const c = count()
    const h2 = createCmdHeaders(c.exec, home, { cacheEntries: 0 })
    expect((await h2.headers(s)).complete).toBe(true)
    expect((await h2.headers(s)).complete).toBe(true)
    expect(c.seen.length).toBe(1) // stayed warm: no re-read
    // Infinity must not disable the pending bound either.
    const h3 = createCmdHeaders(localShell, home, { maxPending: Number.POSITIVE_INFINITY, cacheEntries: Number.NaN })
    expect((await h3.headers(s)).complete).toBe(true)
  })

  it('passes the canonical root positionally inside each request', async () => {
    const home = mkhome()
    putSess(home, 'p', U1)
    const c = count()
    await createCmdHeaders(c.exec, home).headers(await snap(home))
    expect(c.seen[0]?.[0]).toBe(rootOf(home))
    expect(c.seen[0]?.length).toBe(2) // root + one path
  })

  it('chunks large batches on count and reports RPC counts', async () => {
    // The load-bearing part is the batch shape, not the shell: a fake exec
    // answers each request instantly with matching records, so this stays a
    // millisecond unit test instead of forking 70 real reads.
    const home = mkhome()
    const snapFiles = Array.from({ length: 70 }, (_, i) => {
      const id = `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`
      return { file: `${rootOf(home)}/p/${id}.jsonl`, ino: 1000 + i, size: 10, mtimeMs: 1000 }
    })
    const snapshot: CmdFileSnapshot = { complete: true, files: snapFiles, dirs: 1, found: 70 }
    const seen: string[][] = []
    const exec: ShellExec = async (_s, args = []) => {
      seen.push(args)
      const paths = args.slice(1)
      const lines = paths.map((p) => {
        const m = snapFiles.find(f => f.file === p)!
        const body = Buffer.from(hdr(m.file.split('/').pop()!.replace('.jsonl', '')) + 'x\n').toString('base64')
        return `R\x01${Buffer.from(p).toString('base64')}\x01${m.size} ${(m.mtimeMs / 1000).toFixed(3)} ${m.ino} regular file\x01${body}`
      })
      return { code: 0, stdout: Buffer.from(`H\n${lines.join('\n')}\nT ${paths.length} 0 0\n`), stderr: '' }
    }
    const r = await createCmdHeaders(exec, home).headers(snapshot)
    expect(r.complete).toBe(true)
    expect(r.items.length).toBe(70)
    expect(seen.length).toBe(2) // 70 > 64-record batch bound -> two bounded RPCs
    expect(seen.every(a => a.length <= 65)).toBe(true) // root + <=64 paths
    expect(seen.every(a => a[0] === rootOf(home))).toBe(true) // root positional
  })
})

describe('parseCmdHeaders', () => {
  const ROOT = '/home/user/.commandcode/projects'
  const P = (id: string) => `${ROOT}/proj/${id}.jsonl`
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')
  const R = (p: string, stat = '7 1700000000.123 42 regular file', hb = 'e30=') => `R\x01${b64(p)}\x01${stat}\x01${hb}`
  const E = (p: string, why = 'gone') => `E\x01${b64(p)}\x01${why}`
  const inputs = [P(U1), P(U2)]

  it('parses ordered records and per-record errors', () => {
    const r = parseCmdHeaders(inputs, `H\n${R(P(U1))}\n${E(P(U2))}\nT 1 1 0\n`)
    expect(r.bad).toBeUndefined()
    expect(r.records[0]).toMatchObject({ raw: Buffer.from('{}'), st: { ino: 42, size: 7 } })
    expect(r.records[1]).toEqual({ error: 'gone' })
  })

  it('rejects framing, order, count and path mismatches', () => {
    expect(parseCmdHeaders(inputs, `T 1 1 0\n${R(P(U1))}\n`).bad).toBe('truncated')
    expect(parseCmdHeaders(inputs, `H\n${R(P(U2))}\n${R(P(U1))}\nT 2 0 0\n`).bad).toBe('truncated') // wrong order
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1))}\nT 1 0 0\n`).bad).toBe('truncated') // short, no overflow flag
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1))}\n${R(P(U2))}\n${R(P(U1))}\nT 2 0 0\n`).bad).toBe('truncated') // extra record
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1))}\n${E(P(U2))}\nT 1 0 0\n`).bad).toBe('truncated') // e count wrong
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1))}\n${E(P(U2))}\nT 1 1 8\n`).bad).toBe('truncated') // unknown flag
    expect(parseCmdHeaders(inputs, `H\nR\x01${b64('/etc/x')}\x017 1700000000 42 regular file\x01e30K\nT 1 0 0\n`).bad).toBe('truncated') // path not input[0]
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1), 'garbage')}\nT 1 0 0\n`).bad).toBe('truncated')
    expect(parseCmdHeaders(inputs, `H\n${E(P(U1), 'WHY')}\nT 0 1 0\n`).bad).toBe('truncated') // non-word reason
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1))}\n${E(P(U2))}\nT 1 1 ${'9'.repeat(400)}\n`).bad).toBe('truncated') // unsafe counter
  })

  it('accepts an overflowed stream and reports oversize', () => {
    const r = parseCmdHeaders(inputs, `H\n${R(P(U1))}\nT 1 0 4\n`)
    expect(r.bad).toBe('oversize')
    expect(r.records[0]).toMatchObject({ raw: Buffer.from('{}') })
    expect(r.records[1]).toBeNull()
  })

  it('maps every known footer flag to incomplete, even over valid records', () => {
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1))}\n${E(P(U2))}\nT 1 1 1\n`).bad).toBe('metadata')
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1))}\n${R(P(U2))}\nT 2 0 1\n`).bad).toBe('metadata') // flag with all-good records
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1))}\n${R(P(U2))}\nT 2 0 2\n`).bad).toBe('raced')
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1))}\n${R(P(U2))}\nT 2 0 4\n`).bad).toBe('oversize')
  })

  it('requires R and E counts separately, not just their sum', () => {
    // Single input keeps emitted===inputs so only the count split can fire.
    expect(parseCmdHeaders([P(U1)], `H\n${R(P(U1))}\nT 0 1 0\n`).bad).toBe('truncated') // r=0 claimed, an R emitted
    expect(parseCmdHeaders([P(U1)], `H\n${E(P(U1))}\nT 1 0 0\n`).bad).toBe('truncated') // e=0 claimed, an E emitted
  })

  it('bounds inputs and the raw payload before allocating', () => {
    const many = Array.from({ length: 9000 }, (_, i) => `${ROOT}/d${i}/${U1}.jsonl`)
    const r = parseCmdHeaders(many, 'H\nT 0 0 0\n')
    expect(r.bad).toBe('oversize') // cap rejected before any 9000-entry allocation
    expect(r.records).toEqual([])
    // An oversized header payload is rejected before decoding the field.
    const giant = Buffer.alloc(20000, 0x78).toString('base64')
    expect(parseCmdHeaders(inputs, `H\n${R(P(U1), '7 1700000000 42 regular file', giant)}\nT 1 0 0\n`).bad).toBe('truncated')
    // An absurd input path cannot reach the request loop at all.
    const huge = [`${ROOT}/${'x'.repeat(9000)}/${U1}.jsonl`]
    expect(parseCmdHeaders(huge, 'H\nT 0 0 0\n').bad).toBe('truncated')
  })
})

// Producer-level checks run CMD_HEADERS_SCRIPT itself through localShell and
// parse the raw wire — no dependency on the later cache module.
const runScript = async (exec: ShellExec, root: string, files: string[]) => {
  const r = await exec(CMD_HEADERS_SCRIPT, [root, ...files], { timeoutMs: 5000 })
  expect(r.code).toBe(0)
  return parseCmdHeaders(files, r.stdout.toString('utf8'))
}

describe('CMD_HEADERS_SCRIPT', () => {
  it('reads a bounded prefix for every path, however large the file', async () => {
    const home = mkhome()
    const f1 = putSess(home, 'p', U1)
    const f2 = putSess(home, 'q', U2, '/work/two', 'x'.repeat(3 * 1024 * 1024)) // multi-MB body
    const p = await runScript(localShell, rootOf(home), [f1, f2])
    expect(p.bad).toBeUndefined()
    expect(p.records.every(r => r !== null && 'raw' in r)).toBe(true)
    for (const r of p.records) {
      expect((r as { raw: Buffer }).raw.length).toBeLessThanOrEqual(16385)
      expect((r as { raw: Buffer }).raw.indexOf(0x0a)).toBeGreaterThan(0) // full first line inside
    }
  })

  it('keeps a complete 16384-byte header line and its newline', async () => {
    const home = mkhome()
    // head -c 16385 over-reads by one: a complete 16 KiB line + '\n' arrives
    // whole, while a longer line arrives as exactly 16385 bytes with no nl.
    const base = JSON.stringify({ type: 'session', version: 3, id: U1, cwd: '' }).length
    const cwd = '/' + 'x'.repeat(16384 - base - 1)
    const f = put(home, 'p', `${U1}.jsonl`, JSON.stringify({ type: 'session', version: 3, id: U1, cwd }) + '\nbody\n')
    const p = await runScript(localShell, rootOf(home), [f])
    const rec = p.records[0] as { raw: Buffer }
    expect(rec.raw.length).toBe(16385)
    expect(rec.raw[16384]).toBe(0x0a) // the newline survived
    const over = put(home, 'q', `${U2}.jsonl`, `{"type":"session","version":3,"id":"${U2}","cwd":"/${'x'.repeat(20000)}"}\n`)
    const p2 = await runScript(localShell, rootOf(home), [over])
    const raw2 = (p2.records[0] as { raw: Buffer }).raw
    expect(raw2.length).toBe(16385)
    expect(raw2.indexOf(0x0a)).toBe(-1) // overlong: no newline inside the prefix
  })

  it('round-trips newline, unicode and metachar dir names through the wire', async () => {
    const home = mkhome()
    const files = ['a b', 'uni-λ', 'with\nnewline', 'a$HOME`x`'].map(d => putSess(home, d, U1))
    const p = await runScript(localShell, rootOf(home), files)
    expect(p.bad).toBeUndefined()
    expect(p.records.every(r => r !== null && 'raw' in r && r.raw.length > 0)).toBe(true)
  })

  it('refuses symlinked root, project dir and file shapes before any open', async () => {
    const home = mkhome()
    const root = rootOf(home)
    // Project dir renamed and replaced by a symlink: stat still works through
    // it, but the record must be an error, never a followed read.
    const kept = join(root, 'kept')
    mkdirSync(kept, { recursive: true })
    writeFileSync(join(kept, `${U1}.jsonl`), hdr(U1) + 'x\n')
    symlinkSync(kept, join(root, 'p'))
    const p1 = await runScript(localShell, root, [join(root, 'p', `${U1}.jsonl`)])
    expect(p1.records[0]).toEqual({ error: 'dirlink' })
    expect(p1.bad).toBe('metadata')
    // Same trick on the root itself.
    const home2 = mkhome()
    const realRoot = join(home2, 'realprojects')
    mkdirSync(join(realRoot, 'p'), { recursive: true })
    writeFileSync(join(realRoot, 'p', `${U1}.jsonl`), hdr(U1) + 'x\n')
    mkdirSync(join(home2, '.commandcode'), { recursive: true })
    symlinkSync(realRoot, rootOf(home2))
    const p2 = await runScript(localShell, rootOf(home2), [join(rootOf(home2), 'p', `${U1}.jsonl`)])
    expect(p2.records[0]).toEqual({ error: 'rootlink' })
    expect(p2.bad).toBe('metadata')
    // And a symlink where the transcript file itself should be.
    const real = putSess(home2, 'p', U1)
    const link = join(realRoot, 'p', `${U2}.jsonl`)
    symlinkSync(real, link)
    const p3 = await runScript(localShell, realRoot, [link])
    expect(p3.records[0]).toEqual({ error: 'symlink' })
    expect(p3.bad).toBe('metadata')
  })

  it('reports a vanished file and a mid-read stat flip as raced', async () => {
    const home = mkhome()
    const gone = putSess(home, 'p', U1)
    unlinkSync(gone)
    const p1 = await runScript(localShell, rootOf(home), [gone])
    expect(p1.records[0]).toEqual({ error: 'gone' })
    expect(p1.bad).toBe('raced')
    // Second stat of the file reports a different inode -> sa != sb.
    const bin = join(home, 'bin')
    mkdirSync(bin)
    const f = putSess(home, 'q', U2)
    writeFileSync(join(bin, 'stat'), `#!/bin/sh
c=${join(home, 'count')}
n=0; [ -f "$c" ] && n=$(cat "$c")
case "$3" in
  *${U2}*) n=$((n+1)); echo $n > "$c"; [ $n -gt 1 ] && { echo "7 1700000000 999999 regular file"; exit 0; } ;;
esac
exec /usr/bin/stat "$@"
`)
    chmodSync(join(bin, 'stat'), 0o755)
    const exec: ShellExec = (s, a, o) => localShell(`PATH=${bin}:$PATH\n` + s, a, o)
    const p2 = await runScript(exec, rootOf(home), [f])
    expect(p2.records[0]).toEqual({ error: 'changed' })
    expect(p2.bad).toBe('raced')
    expect(statSync(f).isFile()).toBe(true)
  })

  it('rechecks a root swapped for a symlink mid-batch per path', async () => {
    const home = mkhome()
    const fa = putSess(home, 'a', U1) // 'a' sorts first: A reads, then the swap
    const fb = putSess(home, 'b', U2)
    const root = rootOf(home)
    const kept = `${root}.kept`
    const bin = join(home, 'bin')
    mkdirSync(bin)
    // First head invocation serves file A normally, then atomically renames
    // root -> kept and symlinks root -> kept. File B then arrives through a
    // symlinked root with inode/mtime still equal — it must not be read.
    writeFileSync(join(bin, 'head'), `#!/bin/sh
m=${join(home, 'mark')}
if [ ! -f "$m" ]; then
  /usr/bin/head "$@"; rc=$?
  touch "$m"
  mv "${root}" "${kept}" && ln -s "${kept}" "${root}"
  exit $rc
fi
exec /usr/bin/head "$@"
`)
    chmodSync(join(bin, 'head'), 0o755)
    const exec: ShellExec = (s, a, o) => localShell(`PATH=${bin}:$PATH\n` + s, a, o)
    const p = await runScript(exec, root, [fa, fb])
    expect(p.records[0]).toMatchObject({ st: expect.anything() }) // A read fine
    expect(p.records[1]).toEqual({ error: 'rootlink' }) // B refused through the link
    expect(p.bad).toBe('metadata')
  })
})
