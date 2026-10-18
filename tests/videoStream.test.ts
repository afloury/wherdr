import { spawn } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { READ_SCRIPT } from '../server/utils/files'
import type { Machine } from '../server/utils/machines'
import { VIDEO_BLOCK, openVideo, openWrittenVideo, parseRange, readPlan } from '../server/utils/videoStream'

const local = { exec: null } as unknown as Machine
let root = ''
const webm = readFileSync(path.join(__dirname, 'e2e/fixtures/sample.webm'))
// Distinct bytes everywhere, over several dd blocks, behind a WebM header.
const long = Buffer.concat([webm.subarray(0, 12), Buffer.from(Array.from({ length: 3 * VIDEO_BLOCK + 777 }, (_, i) => (i * 7 + (i >> 8)) & 0xFF))])
const BIG = 64 * 1024 ** 3

async function collect(r: NodeJS.ReadableStream) {
  const out: Buffer[] = []
  for await (const c of r as AsyncIterable<Buffer>) out.push(c)
  return Buffer.concat(out)
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wherdr-video-'))
  writeFileSync(path.join(root, 'clip.webm'), webm)
  writeFileSync(path.join(root, 'long.webm'), long)
  writeFileSync(path.join(root, 'fake.mov'), '<html><script>alert(1)</script>\n')
  // 64 GiB, sparse: reading it all would take minutes, a seek takes nothing.
  writeFileSync(path.join(root, 'huge.webm'), webm.subarray(0, 12))
  truncateSync(path.join(root, 'huge.webm'), BIG)
  appendFileSync(path.join(root, 'huge.webm'), 'END!')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('Range header', () => {
  it('takes the first satisfiable range, alone', () => {
    expect(parseRange('bytes=0-1', 100)).toEqual({ kind: 'part', start: 0, end: 1 })
    expect(parseRange('bytes=10-', 100)).toEqual({ kind: 'part', start: 10, end: 99 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ kind: 'part', start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'part', start: 90, end: 99 })
    expect(parseRange('bytes=-500', 100)).toEqual({ kind: 'part', start: 0, end: 99 })
    expect(parseRange('Bytes = 0-10 , 20-30', 100)).toEqual({ kind: 'part', start: 0, end: 10 })
    // A first range past the end does not hide a later valid one.
    expect(parseRange('bytes=1000-1001,0-1', 100)).toEqual({ kind: 'part', start: 0, end: 1 })
    expect(parseRange('bytes=1000-,-5', 100)).toEqual({ kind: 'part', start: 95, end: 99 })
    expect(parseRange('bytes=-0,5-6', 100)).toEqual({ kind: 'part', start: 5, end: 6 })
  })

  it('keeps huge numbers bounded', () => {
    const huge = '9'.repeat(400)
    expect(parseRange(`bytes=0-${huge}`, 100)).toEqual({ kind: 'part', start: 0, end: 99 })
    expect(parseRange(`bytes=-${huge}`, 100)).toEqual({ kind: 'part', start: 0, end: 99 })
    expect(parseRange(`bytes=${huge}-`, 100)).toEqual({ kind: 'none' })
  })

  it('answers 416 only to a valid header with nothing satisfiable', () => {
    expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=-0', 100)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=0-1', 0)).toEqual({ kind: 'none' })
  })

  it('ignores a missing, foreign or invalid header: the whole file', () => {
    for (const h of [undefined, 'items=0-1', 'bytes=', 'bytes=-', 'bytes=5-2', 'bytes=0-1junk', 'bytes=0-1.5', 'bytes=0-1,5-2', 'bytes=0-1;x', 'nonsense']) {
      expect(parseRange(h, 100)).toEqual({ kind: 'full' })
    }
  })
})

describe('read plan', () => {
  it('serves the first bytes from the head, the rest from whole dd blocks', () => {
    expect(readPlan(0, 2, 12)).toEqual({ fromHead: 2, skip: 0, count: 0, drop: 0 })
    expect(readPlan(10, 10, 12)).toEqual({ fromHead: 2, skip: 0, count: 1, drop: 0 })
    expect(readPlan(12, 1, 12)).toEqual({ fromHead: 0, skip: 0, count: 1, drop: 0 })
    expect(readPlan(12 + VIDEO_BLOCK * 5 + 3, VIDEO_BLOCK, 12)).toEqual({ fromHead: 0, skip: 5, count: 2, drop: 3 })
    expect(readPlan(0, 5, 3)).toEqual({ fromHead: 3, skip: 0, count: 1, drop: 0 })
  })
})

describe('video stream', () => {
  it('reads any range of the opened file, exactly', async () => {
    for (const [start, len] of [[0, 2], [0, long.length], [5, 20], [11, 2], [12, 1], [VIDEO_BLOCK, 10], [VIDEO_BLOCK - 3, 7], [long.length - 9, 9], [2 * VIDEO_BLOCK + 100, VIDEO_BLOCK + 500]]) {
      const v = await openVideo(local, root, 'long.webm')
      expect(v.size).toBe(long.length)
      expect(Buffer.compare(await collect(v.read(start!, len!)), long.subarray(start!, start! + len!))).toBe(0)
      await v.done
    }
  })

  it('gives an identity that changes with the file', async () => {
    const a = await openVideo(local, root, 'clip.webm')
    a.close()
    expect(a.etag).toMatch(/^"\d+-\d+-\d+"$/)
    expect(a.name).toBe('clip.webm')
    writeFileSync(path.join(root, 'other.webm'), long)
    renameSync(path.join(root, 'other.webm'), path.join(root, 'clip2.webm'))
    const b = await openVideo(local, root, 'clip2.webm')
    b.close()
    expect(b.etag).not.toBe(a.etag)
  })

  // The review's P1: BusyBox's wc -c and tail -c +N read every byte before
  // the one asked. Here a 64 GiB file: only seeks finish in time.
  it('seeks: a two-byte probe and the last bytes of a 64 GiB file come at once', async () => {
    const t = Date.now()
    const probe = await openVideo(local, root, 'huge.webm')
    expect(probe.size).toBe(BIG + 4)
    expect(Buffer.compare(await collect(probe.read(0, 2)), webm.subarray(0, 2))).toBe(0)
    const end = await openVideo(local, root, 'huge.webm')
    expect((await collect(end.read(BIG, 4))).toString()).toBe('END!')
    const preview = await new Promise<string>((resolve) => {
      const c = spawn('sh', ['-c', READ_SCRIPT, 'sh', root, 'huge.webm', '12'])
      let out = ''
      c.stdout.on('data', (b: Buffer) => { out += b.toString('latin1') })
      c.on('close', () => resolve(out))
    })
    expect(preview.split('\n')[0]).toBe(String(BIG + 4))
    expect(Date.now() - t).toBeLessThan(3000)
  })

  it('serves the bytes of the file it opened, never more than its size', async () => {
    writeFileSync(path.join(root, 'grow.webm'), long)
    const grown = await openVideo(local, root, 'grow.webm')
    appendFileSync(path.join(root, 'grow.webm'), Buffer.alloc(5000, 1))
    expect((await collect(grown.read(0, grown.size))).length).toBe(long.length)

    writeFileSync(path.join(root, 'shrink.webm'), long)
    const shrunk = await openVideo(local, root, 'shrink.webm')
    truncateSync(path.join(root, 'shrink.webm'), 100)
    expect(Buffer.compare(await collect(shrunk.read(0, shrunk.size)), long.subarray(0, 100))).toBe(0)

    // Replaced by a rename between opening and reading: still the opened file.
    writeFileSync(path.join(root, 'swap.webm'), long)
    const swapped = await openVideo(local, root, 'swap.webm')
    writeFileSync(path.join(root, 'next.webm'), webm)
    renameSync(path.join(root, 'next.webm'), path.join(root, 'swap.webm'))
    expect(Buffer.compare(await collect(swapped.read(0, swapped.size)), long)).toBe(0)
  })

  it('stops reading when the request is dropped', async () => {
    const v = await openVideo(local, root, 'huge.webm')
    const r = v.read(0, 16 * 1024 ** 3)
    for await (const _ of r) break
    const exited = await Promise.race([v.done.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 2000))])
    expect(exited).toBe(true)
    // Closed before any read (HEAD, 416): nothing left running either.
    const head = await openVideo(local, root, 'clip.webm')
    head.close()
    await head.done
  })

  it('refuses a file whose signature is not its extension, and paths outside', async () => {
    await expect(openVideo(local, root, 'fake.mov')).rejects.toMatchObject({ code: 'not_video' })
    await expect(openVideo(local, root, '../x.webm')).rejects.toMatchObject({ code: 'outside' })
    await expect(openVideo(local, root, 'missing.webm')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('streams through the machine’s shell session, refused when offline', async () => {
    const calls: string[][] = []
    const remote = (online: boolean) => ({
      home: root,
      exec: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: '' }),
      spawnShell: (script: string, args: string[]) => {
        calls.push(args)
        return online ? spawn('sh', ['-c', script, 'sh', ...args]) : null
      },
    }) as unknown as Machine
    const v = await openWrittenVideo(remote(true), root, 'long.webm')
    expect(calls.at(-1)).toEqual([path.resolve(root), 'long.webm'])
    expect(Buffer.compare(await collect(v.read(VIDEO_BLOCK, 30)), long.subarray(VIDEO_BLOCK, VIDEO_BLOCK + 30))).toBe(0)
    await expect(openWrittenVideo(remote(false), root, 'long.webm')).rejects.toMatchObject({ code: 'unreachable' })
  })
})
