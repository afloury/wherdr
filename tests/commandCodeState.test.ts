// File-scoped Command Code state: per-file result/watch maps, trusted
// (size, gen, inode) evidence, invalidation stamps and the reader nonce —
// lifecycle and watch-validation coverage: matched and orphan records proven
// by bytes, the bounded newest span, watch bounds and the pending cap.
// Driven by fake disks and gated promises only, never a real home/proc/agent.
import { describe, expect, it } from 'vitest'
import { createCommandCodeState } from '../server/utils/commandCodeState'
import { watchFingerprint } from '../server/utils/commandCodeWatch'
import { defer, line, memFs, WATCH_BYTES, WATCH_SPAN, type MemFile, type MemIo } from './cmdStateFixture'

const FILE = '/home/user/.commandcode/projects/-w-proj/s1.jsonl'

describe('commandCodeState', () => {
  it('tracks a new file, an unchanged stat and a growing append', async () => {
    const disk: Record<string, MemFile> = { [FILE]: { body: Buffer.from(line('u1', 'one')), mtimeMs: 1, ino: 9 } }
    const reads: { start: number, len: number }[] = []
    const s = createCommandCodeState({ fs: memFs(disk, { reads }) })
    const first = await s.observe(FILE)
    expect(first.invalidated).toBe(true) // a new entry: its clients rebuild
    expect(first.st?.size).toBe(disk[FILE]!.body.length)
    const again = await s.observe(FILE)
    expect(again).toMatchObject({ invalidated: false, stamp: first.stamp })
    // A growing append keeps everything; with no watches nothing is read.
    disk[FILE]!.body = Buffer.concat([disk[FILE]!.body, Buffer.from('\n' + line('u2', 'two'))])
    const grown = await s.observe(FILE)
    expect(grown).toMatchObject({ invalidated: false, stamp: first.stamp })
    expect(reads).toEqual([])
    expect(s.stampOf(FILE)).toBe(first.stamp)
  })

  it('detects a truncate, a new inode and a same-size rewrite', async () => {
    const disk: Record<string, MemFile> = { [FILE]: { body: Buffer.from(line('u1', 'one') + '\n' + line('u2', 'two')), mtimeMs: 1, ino: 9 } }
    const s = createCommandCodeState({ fs: memFs(disk) })
    const first = await s.observe(FILE)
    disk[FILE]!.body = Buffer.from(line('u1', 'one')) // shorter: a truncation
    const cut = await s.observe(FILE)
    expect(cut).toMatchObject({ invalidated: true, stamp: first.stamp + 1 })
    const stable = await s.observe(FILE)
    disk[FILE]!.ino = 77 // another inode: a different file replaced it
    const inode = await s.observe(FILE)
    expect(inode).toMatchObject({ invalidated: true, stamp: stable.stamp + 1 })
    // Same size, another generation: rewritten in place within one second.
    const size = disk[FILE]!.body.length
    disk[FILE]!.body = Buffer.from(line('u1', 'ONE').padEnd(size, ' '))
    disk[FILE]!.mtimeMs = 2
    const gen = await s.observe(FILE)
    expect(gen).toMatchObject({ invalidated: true, stamp: inode.stamp + 1 })
    expect((await s.observe(FILE)).invalidated).toBe(false)
  })

  it('invalidates on any inode continuity change while growing — both directions', async () => {
    for (const [from, to] of [[9, undefined], [undefined, 9]] as const) {
      const disk: Record<string, MemFile> = { [FILE]: { body: Buffer.from(line('u1', 'one')), mtimeMs: 1, ino: from } }
      const reads: { start: number, len: number }[] = []
      const s = createCommandCodeState({ fs: memFs(disk, { reads }) })
      const first = await s.observe(FILE)
      s.handle(FILE).results.set('t1', { out: 'kept' })
      disk[FILE]!.ino = to // continuity evidence changed while appending
      disk[FILE]!.body = Buffer.concat([disk[FILE]!.body, Buffer.from('\nmore')])
      const o = await s.observe(FILE)
      expect(o.invalidated).toBe(true)
      expect(o.stamp).not.toBe(first.stamp)
      // A replacement, not a validation masquerading as continuity.
      expect(reads).toEqual([])
      expect(s.handle(FILE).results.size).toBe(0)
    }
  })

  it('detaches stale result/watch handles after truncate and eviction', async () => {
    const disk: Record<string, MemFile> = { [FILE]: { body: Buffer.from(line('u1', 'one')), mtimeMs: 1, ino: 9 } }
    const s = createCommandCodeState({ fs: memFs(disk) })
    await s.observe(FILE)
    const old = s.handle(FILE)
    old.results.set('t1', { out: 'kept' })
    old.watch('t1', { at: 0, len: 5, hash: 'h' })
    disk[FILE]!.body = Buffer.from('short')
    await s.observe(FILE)
    // A new generation: the old handle's maps are void, its stamp stale.
    const fresh = s.handle(FILE)
    expect(fresh.stamp).toBe(s.stampOf(FILE))
    expect(old.stamp).not.toBe(s.stampOf(FILE))
    expect(fresh.results).not.toBe(old.results)
    old.results.set('t2', { out: 'stale' })
    expect(fresh.results.size).toBe(0)
    // A stale watch that mismatches the new file must not reach it either:
    // seed a valid fresh watch + result, send the stale one, then grow.
    // Its at sits inside the read span so a misdirected entry would hash
    // real bytes and invalidate — never just shrink the verified span.
    fresh.results.set('t2', { out: 'fresh' })
    fresh.watch('t2', watchFingerprint(disk[FILE]!.body, 0, disk[FILE]!.body.length)!)
    old.watch('t3', watchFingerprint(Buffer.from('different'), 1, 4)!)
    disk[FILE]!.body = Buffer.concat([disk[FILE]!.body, Buffer.from('\nmore')])
    const o = await s.observe(FILE)
    expect(o).toMatchObject({ invalidated: false, stamp: fresh.stamp })
    expect(o.st?.size).toBe(disk[FILE]!.body.length)
    expect(s.handle(FILE).results.size).toBe(1)
    // And after the file's entry is evicted entirely, the same holds:
    // a fresh generation observes and grows while stale writes stay void.
    const before = s.handle(FILE)
    for (let i = 0; i < 64; i++) s.handle(`/f/x${i}`)
    expect(before.stamp).not.toBe(s.stampOf(FILE))
    before.results.set('t3', { out: 'stale' })
    expect(s.handle(FILE).results.size).toBe(0)
    const fresh2 = s.handle(FILE)
    expect((await s.observe(FILE)).invalidated).toBe(true) // re-created entry
    fresh2.results.set('t2', { out: 'fresh2' })
    fresh2.watch('t2', watchFingerprint(disk[FILE]!.body, 0, disk[FILE]!.body.length)!)
    before.watch('t3', watchFingerprint(Buffer.from('different'), 1, 4)!)
    disk[FILE]!.body = Buffer.concat([disk[FILE]!.body, Buffer.from(' tail')])
    const o2 = await s.observe(FILE)
    expect(o2).toMatchObject({ invalidated: false, stamp: fresh2.stamp })
    expect(o2.st?.size).toBe(disk[FILE]!.body.length)
    expect(s.handle(FILE).results.size).toBe(1)
  })

  it('exposes an unvalidated observation as unknown and retries it', async () => {
    const rec = Buffer.from(line('u1', 'out'))
    const disk: Record<string, MemFile> = { [FILE]: { body: rec, mtimeMs: 1, ino: 9 } }
    const io: MemIo = { reads: [] }
    const s = createCommandCodeState({ fs: memFs(disk, io) })
    const first = await s.observe(FILE)
    s.handle(FILE).watch('t1', watchFingerprint(rec, 0, rec.length)!)
    disk[FILE]!.body = Buffer.concat([rec, Buffer.from('\ntail')])
    io.onRead = async () => { throw new Error('remote cut') }
    const unknown = await s.observe(FILE)
    // Unknown: no stat to trust, trusted size/gen held, same stamp.
    expect(unknown).toMatchObject({ st: null, invalidated: false, stamp: first.stamp })
    io.onRead = async () => Buffer.alloc(5) // short: the record can't be found
    expect((await s.observe(FILE)).st).toBeNull()
    io.onRead = undefined
    const retried = await s.observe(FILE)
    expect(retried).toMatchObject({ invalidated: false, stamp: first.stamp })
    expect(retried.st?.size).toBe(disk[FILE]!.body.length)
    expect(io.reads!.length).toBe(3)
    await s.observe(FILE)
    expect(io.reads!.length).toBe(3) // trusted now: no revalidation
  })

  it('lets no stale awaited stat publish under a fresh stamp', async () => {
    const disk: Record<string, MemFile> = { [FILE]: { body: Buffer.from('old-body'), mtimeMs: 1, ino: 9 } }
    const gate = defer()
    const entered = defer()
    const s = createCommandCodeState({
      fs: memFs(disk, { onStat: async () => { entered.resolve(); await gate.promise } }),
    })
    const stale = s.observe(FILE) // stat captured, then pends on the gate
    await entered.promise // the captured-old stat is in flight
    // While it awaits: evict the entry, change the file, seed a fresh generation.
    for (let i = 0; i < 64; i++) s.handle(`/f/x${i}`)
    disk[FILE]!.body = Buffer.from('grown-new')
    disk[FILE]!.ino = 42
    const fresh = s.handle(FILE)
    fresh.results.set('t1', { out: 'fresh' })
    gate.resolve()
    const late = await stale
    expect(late).toMatchObject({ st: null, invalidated: true })
    expect(late.stamp).toBe(fresh.stamp)
    expect(s.handle(FILE).results.size).toBe(1) // fresh maps survive
    // The abandoned stat wrote nothing: a real observation returns the
    // file's actual new stat, not the captured-old one.
    const real = await s.observe(FILE)
    expect(real.invalidated).toBe(true)
    expect(real.st).toMatchObject({ size: 'grown-new'.length, ino: 42 })
  })

  it('lets no stale awaited validation publish its stat under a fresh stamp', async () => {
    const rec = Buffer.from(line('u1', 'out'))
    const disk: Record<string, MemFile> = { [FILE]: { body: rec, mtimeMs: 1, ino: 9 } }
    const gate = defer()
    const entered = defer()
    const reads: { start: number, len: number }[] = []
    const s = createCommandCodeState({
      fs: memFs(disk, { reads, onRead: async () => { entered.resolve(); await gate.promise } }),
    })
    const first = await s.observe(FILE)
    s.handle(FILE).watch('t1', watchFingerprint(rec, 0, rec.length)!)
    // Grow in place: validation of the new state pends on the gated read.
    disk[FILE]!.body = Buffer.concat([rec, Buffer.from('\nmore')])
    const stale = s.observe(FILE)
    await entered.promise // the old record is bound; its read is in flight
    // While it awaits, the file's entry is evicted — newer state wins.
    for (let i = 0; i < 64; i++) s.handle(`/f/x${i}`)
    gate.resolve()
    const late = await stale
    expect(late).toMatchObject({ st: null, invalidated: true })
    expect(late.stamp).not.toBe(first.stamp)
    // The abandoned validation wrote nothing: the fresh entry has no
    // watches, so the next observation does no read at all.
    const fresh = await s.observe(FILE)
    expect(fresh.invalidated).toBe(true)
    expect(reads.length).toBe(1)
    expect(s.handle(FILE).results.size).toBe(0)
  })

  it('binds invalidate to the generation its proof was made under', async () => {
    const disk: Record<string, MemFile> = { [FILE]: { body: Buffer.from('v1'), mtimeMs: 1, ino: 9 } }
    const s = createCommandCodeState({ fs: memFs(disk) })
    const first = await s.observe(FILE)
    // Proof of another stamp: nothing minted, the current record stands.
    expect(s.invalidate(FILE, first.stamp + 1)).toBe(false)
    expect(s.invalidate(FILE, 0)).toBe(false)
    expect(s.invalidate('/absent', 1)).toBe(false)
    expect(s.stampOf(FILE)).toBe(first.stamp)
    // A matching stamp advances the generation — stale proofs are void after.
    expect(s.invalidate(FILE, first.stamp)).toBe(true)
    expect(s.stampOf(FILE)).toBe(first.stamp + 1)
    expect(s.handle(FILE).stamp).toBe(first.stamp + 1)
    expect(s.invalidate(FILE, first.stamp)).toBe(false)
    expect(s.stampOf(FILE)).toBe(first.stamp + 1)
  })

  it('starts each reader with a fresh nonce and empty state', () => {
    const fs = memFs({ [FILE]: { body: Buffer.from('x'), mtimeMs: 1, ino: 9 } })
    const a = createCommandCodeState({ fs })
    const b = createCommandCodeState({ fs })
    expect(a.reader).not.toBe(b.reader)
    expect(a.stampOf(FILE)).toBe(0) // nothing tracked until observed
  })

  it('does not track a directory where the transcript was expected', async () => {
    const s = createCommandCodeState({ fs: memFs({ [FILE]: { body: Buffer.alloc(0), isDir: true } }) })
    const o = await s.observe(FILE)
    expect(o.invalidated).toBe(false)
    expect(s.stampOf(FILE)).toBe(0)
    await expect(s.observe('/gone')).rejects.toThrow('no such file')
  })

  describe('watch-validation observations', () => {
  it('validates watched records on a growing file — matched or orphan', async () => {
    const rec1 = Buffer.from(line('u1', 'matched out'))
    const rec2 = Buffer.from(line('u2', 'orphan out'))
    const body = Buffer.concat([rec1, Buffer.from('\n'), rec2])
    const disk: Record<string, MemFile> = { [FILE]: { body, mtimeMs: 1, ino: 9 } }
    const reads: { start: number, len: number }[] = []
    const s = createCommandCodeState({ fs: memFs(disk, { reads }) })
    const first = await s.observe(FILE)
    const h = s.handle(FILE)
    // One watch per parsed result, matched or orphan (t1/t2 here).
    h.watch('t1', watchFingerprint(rec1, 0, rec1.length)!)
    h.watch('t2', watchFingerprint(rec2, rec1.length + 1, rec2.length)!)
    disk[FILE]!.body = Buffer.concat([body, Buffer.from('\n' + line('u3', 'three'))])
    const ok = await s.observe(FILE)
    expect(ok).toMatchObject({ invalidated: false, stamp: first.stamp })
    expect(reads).toEqual([{ start: 0, len: body.length }]) // one read covers both
    // Rewrite bytes inside the second record while GROWING past the last
    // trusted size: only the bounded watch read can catch this, never a
    // shrink/replacement check.
    const bad = Buffer.concat([disk[FILE]!.body, Buffer.from('\nxxxx')])
    bad[rec1.length + 5] = 0x21
    disk[FILE]!.body = bad
    expect(disk[FILE]!.body.length).toBeGreaterThan(ok.st!.size)
    const broken = await s.observe(FILE)
    expect(reads.length).toBe(2) // a second actual bounded validation read
    expect(reads[1]).toEqual({ start: 0, len: body.length })
    expect(broken.invalidated).toBe(true)
    expect(broken.stamp).not.toBe(ok.stamp)
    expect(s.handle(FILE).results.size).toBe(0)
  })

  it('reads only the newest watched span over the cap', async () => {
    const at1 = 0, at2 = 3_000_000, at3 = 7_000_000
    const body = Buffer.alloc(at3 + 200, 0x61)
    const rec = (at: number, len: number) => { body.fill(0x62, at, at + len); return watchFingerprint(body.subarray(at, at + len), at, len)! }
    const w1 = rec(at1, 100), w2 = rec(at2, 100), w3 = rec(at3, 100)
    const disk: Record<string, MemFile> = { [FILE]: { body, mtimeMs: 1, ino: 9 } }
    const reads: { start: number, len: number }[] = []
    const s = createCommandCodeState({ fs: memFs(disk, { reads }) })
    await s.observe(FILE)
    const h = s.handle(FILE)
    h.watch('t1', w1); h.watch('t2', w2); h.watch('t3', w3)
    disk[FILE]!.body = Buffer.concat([body, Buffer.from('new tail')])
    const o = await s.observe(FILE)
    expect(o.invalidated).toBe(false)
    // One read, bounded, covering only the records that fit the newest span.
    expect(reads.length).toBe(1)
    expect(reads[0]!.len).toBeLessThanOrEqual(WATCH_SPAN)
    expect(reads[0]!.start).toBe(at2)
    expect(reads[0]!.start + reads[0]!.len).toBe(at3 + 100)
  })

  it('coalesces concurrent observations into one stat', async () => {
    const stats = { n: 0 }
    const gate = defer()
    const s = createCommandCodeState({
      fs: memFs({ [FILE]: { body: Buffer.from('x'), mtimeMs: 1, ino: 9 } }, { stats, onStat: () => gate.promise }),
    })
    const a = s.observe(FILE)
    const b = s.observe(FILE)
    expect(a).toBe(b)
    gate.resolve()
    await a
    expect(stats.n).toBe(1)
  })

  it('keeps only the newest watch per id', async () => {
    const rec = Buffer.from(line('u1', 'out'))
    const disk: Record<string, MemFile> = { [FILE]: { body: Buffer.concat([Buffer.alloc(500, 0x61), rec]), mtimeMs: 1, ino: 9 } }
    const reads: { start: number, len: number }[] = []
    const s = createCommandCodeState({ fs: memFs(disk, { reads }) })
    await s.observe(FILE)
    const h = s.handle(FILE)
    h.watch('t1', watchFingerprint(rec, 500, rec.length)!)
    h.watch('t1', watchFingerprint(disk[FILE]!.body.subarray(0, 10), 0, 10)!) // older offset: dropped
    disk[FILE]!.body[7] = 0x62 // corrupt only the dropped watch's span, then grow
    disk[FILE]!.body = Buffer.concat([disk[FILE]!.body, Buffer.from('\ntail')])
    const o = await s.observe(FILE)
    expect(o.invalidated).toBe(false)
    expect(reads).toEqual([{ start: 500, len: rec.length }])
    // A newer record for the same id replaces the watch instead.
    const rec2 = Buffer.from(line('u2', 'newer'))
    h.watch('t1', watchFingerprint(rec2, 900, rec2.length)!)
    disk[FILE]!.body = Buffer.concat([disk[FILE]!.body, Buffer.alloc(400, 0x63)])
    disk[FILE]!.body.fill(0x21, 500, 510) // corrupt the superseded span, unseen
    const o2 = await s.observe(FILE)
    expect(o2.invalidated).toBe(true)
    expect(reads[1]!.start).toBe(900)
  })

  it('bounds watches per file — the oldest fingerprints are forgotten', async () => {
    const disk: Record<string, MemFile> = { [FILE]: { body: Buffer.alloc(20_000, 0x61), mtimeMs: 1, ino: 9 } }
    const reads: { start: number, len: number }[] = []
    const s = createCommandCodeState({ fs: memFs(disk, { reads }) })
    await s.observe(FILE)
    const h = s.handle(FILE)
    // 4100 watches over the 4096 cap: the first four leave the set.
    for (let i = 0; i < 4100; i++) h.watch(`t${i}`, { at: i * 4, len: 1, hash: `h${i}` })
    disk[FILE]!.body = Buffer.alloc(30_000, 0x61)
    await s.observe(FILE)
    // The first record the read covers is the fifth registered.
    expect(reads[0]!.start).toBe(16)
  })

  it('samples only the prefix of a giant watched record', async () => {
    const rec = Buffer.alloc(5 * 1024 * 1024, 0x61)
    const disk: Record<string, MemFile> = { [FILE]: { body: rec, mtimeMs: 1, ino: 9 } }
    const reads: { start: number, len: number }[] = []
    const s = createCommandCodeState({ fs: memFs(disk, { reads }) })
    await s.observe(FILE)
    s.handle(FILE).watch('t1', watchFingerprint(rec, 0, rec.length)!)
    disk[FILE]!.body = Buffer.concat([rec, Buffer.from('\nx')])
    const o = await s.observe(FILE)
    expect(o.invalidated).toBe(false)
    expect(reads).toEqual([{ start: 0, len: WATCH_BYTES }])
  })

  it('evicts only the evicted file — other stamps survive and old ones never reissue', () => {
    const s = createCommandCodeState({ fs: memFs({}) })
    const a = '/f/a', b = '/f/b'
    s.handle(a); s.handle(b)
    const stampA = s.stampOf(a)
    const stampB = s.stampOf(b)
    // 63 more entries push the oldest ('a') out of the 64-file bound.
    for (let i = 0; i < 63; i++) s.handle(`/f/x${i}`)
    expect(s.stampOf(a)).toBe(0)
    expect(s.stampOf(b)).toBe(stampB)
    // 'a' comes back as a new entry: its old stamp can never be reissued,
    // so no token minted on it can compare current again.
    s.handle(a)
    expect(s.stampOf(a)).not.toBe(stampA)
    expect(s.stampOf(a)).toBeGreaterThan(stampA)
  })

  it('coalesces at the pending cap, keeps every live promise, and recovers', async () => {
    const disk: Record<string, MemFile> = {}
    for (let i = 0; i < 70; i++) disk[`/f/p${i}`] = { body: Buffer.from('x'), mtimeMs: 1, ino: 9 }
    let calls = 0
    const gates: (() => void)[] = []
    const io: MemIo = { onStat: async () => { calls++; await new Promise<void>(r => gates.push(r)) } }
    const s = createCommandCodeState({ fs: memFs(disk, io) })
    const lives = Array.from({ length: 64 }, (_, i) => s.observe(`/f/p${i}`))
    // A distinct 65th file launches no IO at the cap — synchronously: an
    // uncapped observe would already have issued its stat call.
    const overP = s.observe('/f/p64')
    expect(calls).toBe(64)
    const over = await overP
    expect(over).toMatchObject({ st: null, stamp: 0, invalidated: false })
    // Same-file at the cap still coalesces into the live promise.
    expect(s.observe('/f/p0')).toBe(lives[0])
    // Release one; the next distinct observe launches its own stat.
    gates[0]!()
    await lives[0]
    const p64 = s.observe('/f/p64')
    expect(calls).toBe(65)
    gates[gates.length - 1]!()
    const recovered = await p64
    expect(recovered).toMatchObject({ invalidated: true })
    expect(recovered.st?.size).toBe(1)
    gates.forEach(g => g())
    await Promise.all(lives.slice(1))
  })

  it('drops out-of-contract watch registration — proven by later validation', async () => {
    const rec = Buffer.from(line('u1', 'out'))
    const disk: Record<string, MemFile> = { [FILE]: { body: rec, mtimeMs: 1, ino: 9 } }
    const reads: { start: number, len: number }[] = []
    const s = createCommandCodeState({ fs: memFs(disk, { reads }) })
    await s.observe(FILE)
    const h = s.handle(FILE)
    const wrong = watchFingerprint(Buffer.from('different'), 0, 6)!
    h.watch('', wrong) // empty id
    h.watch('x'.repeat(129), wrong) // over the 128-byte contract
    h.watch('€'.repeat(65), wrong) // 65 chars but 195 UTF-8 bytes
    h.watch('t1', { at: 0, len: 5, hash: 'h'.repeat(65) }) // oversized hash
    h.watch('t2', { at: -1, len: 5, hash: 'h' }) // malformed position
    h.watch('t3', { at: Number.MAX_SAFE_INTEGER - 5, len: 20, hash: 'h' }) // overflowed end
    h.watch('t4', { at: 0, len: Number.NaN, hash: 'h' })
    disk[FILE]!.body = Buffer.concat([rec, Buffer.from('\ntail')])
    const o = await s.observe(FILE)
    // Every write dropped: no validation read, the growth stays trusted.
    expect(reads).toEqual([])
    expect(o).toMatchObject({ invalidated: false })
    expect(o.st?.size).toBe(disk[FILE]!.body.length)
    // An in-contract watch does register and is validated on the next grow.
    h.watch('t5', watchFingerprint(disk[FILE]!.body, 0, disk[FILE]!.body.length)!)
    disk[FILE]!.body = Buffer.concat([disk[FILE]!.body, Buffer.from('x')])
    expect((await s.observe(FILE)).invalidated).toBe(false)
    expect(reads.length).toBe(1)
  })
  })
})
