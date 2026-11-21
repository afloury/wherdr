// Bounded reads of an append-only JSONL transcript, shared by every reader
// of one (Claude's, Codex's, the next ones): a byte range always aligned to
// a line start, a backwards walk by windows, the bottom of a conversation
// read from a cursor or incrementally between polls. Every read goes through
// a MachineFs — the local disk, or a remote machine's multiplexed connection
// (see fsx.ts) — and stays bounded: a window that holds no line start (a
// multi-MB line, a screenshot in base64) is widened within the caps, never
// past them.
//
// The readers keep their parsers: each call carries a WindowReader saying how
// one window's complete lines become items, how the windows of a walk join,
// and what a poll keeps between polls. The helpers never look inside the
// items.
import { createHash, type Hash } from 'node:crypto'
import type { MachineFs } from './fsx'

// Backward reading by windows until there are enough messages: transcripts
// embed images in base64, a few screenshots weigh several MB for three lines
// of conversation.
export const WINDOW_BYTES = 2 * 1024 * 1024
export const MAX_READ_BYTES = 24 * 1024 * 1024 // per request
export const PAGE_ITEMS = 120

// Join check of a re-read from a cursor: the bytes just above it, hashed
// (see anchorAt). A transcript rewritten at the same size, or shortened but
// still longer than the cursor, keeps the token's size and may keep a line
// start at the cursor, so a client would splice a new bottom under pages of
// another file; the anchor of its start tells them apart.
export const ANCHOR_BYTES = 4096
export const anchorHash = (b: Uint8Array) => createHash('sha1').update(b).digest('hex').slice(0, 12)

// Bytes checked above the bottom kept between polls (see readBelow).
const CHECK_BYTES = 4096
// Kept bottoms: at most this many, holding at most this much in total.
const MAX_BELOW = 8
const MAX_KEPT_BYTES = 48 * 1024 * 1024

// A window of complete lines: `start` is the absolute offset of `text`'s
// first byte, always a line start of the file.
export interface ReadWindow { start: number, text: string }

// One poll of the bottom of a conversation.
export interface BottomRead<W> { start: number, parsed: W, anchor?: string }

// State of one retained bottom: fed the complete lines appended since the
// last poll (the first one's byte at `base`), asked for this poll's items,
// and charged for the bytes it keeps between polls.
export interface BottomState<W> {
  feed: (text: string, base: number) => void
  result: () => W
  kept: () => number
}

// How a reader parses its lines. `label` keeps the caches of two kinds read
// through the same file name apart; the rest is the reader's own.
export interface WindowReader<W> {
  label: string
  // Parse the complete lines of a window whose first byte is at `base`.
  parse: (text: string, base: number) => W
  // The parses of a backwards walk, in file order, as one result.
  join: (windows: W[]) => W
  // Items a parse holds (the walk stops past pageItems). Arrays by default.
  count?: (w: W) => number
  // A line reduced before it is parsed as a whole (its base64 emptied, say):
  // the check that a line being written is already complete stays cheap.
  reduce?: (line: string) => string
  // The writer may rewrite bytes below the cursor instead of only appending:
  // every byte below the cursor is verified, not just the last CHECK_BYTES.
  whole?: boolean
  // A state kept between polls for the bytes appended below a cursor (see
  // readBelow). Without one, the whole span below the cursor is parsed again
  // at every poll.
  bottom?: () => BottomState<W>
}

// The bounded reads of one transcript reader: created with the disk the
// transcripts live on (the machine's fs) and the caps of its reads.
export function createBoundedReads<W>(fs: MachineFs, caps: { windowBytes?: number, maxBytes?: number, pageItems?: number } = {}) {
  const windowBytes = caps.windowBytes ?? WINDOW_BYTES
  const maxBytes = caps.maxBytes ?? MAX_READ_BYTES
  const pageItems = caps.pageItems ?? PAGE_ITEMS
  const countOf = (w: WindowReader<W>, parsed: W) => (w.count ? w.count(parsed) : Array.isArray(parsed) ? parsed.length : 0)

  // Reads bytes [start, end) of the file. If `start` falls in the middle of a
  // line, it is skipped: the returned `start` is always a line start. A
  // `start` already at a line start (the byte before is a newline) is kept:
  // re-reading the bottom from a known start must not lose its first message.
  async function readRange(file: string, start: number, end: number): Promise<ReadWindow> {
    if (start <= 0) return { start: 0, text: (await fs.read(file, 0, end)).toString('utf8') }
    const buf = await fs.read(file, start - 1, end - start + 1)
    const nl = buf.indexOf(0x0a)
    const off = nl < 0 ? buf.length : nl + 1
    return { start: start - 1 + off, text: buf.subarray(off).toString('utf8') }
  }

  // Fingerprint of the bytes just above `start` (of none, at the file's
  // start): a re-read from that start checks it first.
  async function anchorAt(file: string, start: number): Promise<string> {
    const s0 = Math.max(0, start - ANCHOR_BYTES)
    return anchorHash(start > 0 ? await fs.read(file, s0, start - s0) : new Uint8Array())
  }

  // Goes back from `end` by windows up to pageItems messages (or the start):
  // each window is parsed alone (a tool result in error whose call is in the
  // previous window just loses its red mark), the parses joined in file order.
  async function readBackwards(file: string, end: number, w: WindowReader<W>): Promise<{ start: number, parsed: W }> {
    let start = end
    const windows: W[] = []
    let total = 0
    while (start > 0 && end - start < maxBytes) {
      // Window widened as long as it contains no line start (a
      // multi-MB line: message with images), within the cap.
      let win = windowBytes
      let r: ReadWindow
      for (;;) {
        const s0 = Math.max(0, start - win)
        r = await readRange(file, s0, start)
        if (r.start < start || s0 === 0 || win >= maxBytes) break
        win *= 2
      }
      if (r.start === start) break // giant line beyond the cap: stop there
      const parsed = w.parse(r.text, r.start)
      windows.unshift(parsed) // joined in file order, newest window last
      total += countOf(w, parsed)
      start = r.start
      if (total >= pageItems) break
    }
    return { start, parsed: w.join(windows) }
  }

  // The whole bottom from `from`, read and parsed again. One read for the
  // anchor above `from` and the bottom (as readRange: a `from` in the middle
  // of a line skips to the next line start). `size - from` bounds the read:
  // callers keep it within maxBytes (readTail does).
  async function readSlice(file: string, size: number, from: number, w: WindowReader<W>): Promise<BottomRead<W>> {
    const s0 = Math.max(0, from - ANCHOR_BYTES)
    const buf = await fs.read(file, s0, size - s0)
    const above = buf.subarray(0, from - s0)
    let off = from - s0
    if (from > 0 && above[above.length - 1] !== 0x0a) {
      const nl = buf.indexOf(0x0a, off)
      off = nl < 0 ? buf.length : nl + 1
    }
    const parsed = w.parse(buf.subarray(off).toString('utf8'), s0 + off)
    // Start kept even when it moves to the next line: the client then sees a
    // stale anchor (or another start) and reloads from the bottom.
    return { start: from, parsed, anchor: off === from - s0 ? anchorHash(above) : '' }
  }

  // Bottom below a client's cursor, kept between polls: while an agent
  // writes, each poll reads only the bytes appended since (and the few KB
  // around to check the rest is still there) instead of everything from the
  // cursor. The reader's bottom state is fed the complete lines appended
  // since; without one, the whole span below the cursor is parsed again.
  interface Below { ino?: number, start: number, end: number, above: string, aligned: boolean, check: string, state: BottomState<W> }
  const below = new Map<string, Below>()
  const queues = new Map<string, Promise<unknown>>()
  // One update at a time per bottom (several devices, polls overlapping).
  function locked<T>(key: string, run: () => Promise<T>): Promise<T> {
    const r = (queues.get(key) || Promise.resolve()).then(run)
    const done = r.catch(() => {})
    queues.set(key, done)
    void done.then(() => { if (queues.get(key) === done) queues.delete(key) })
    return r
  }
  async function readBelow(file: string, size: number, from: number, ino: number | undefined, w: WindowReader<W>): Promise<BottomRead<W>> {
    if (!w.bottom) return await readSlice(file, size, from, w)
    const key = `${file}|${w.label}|${from}`
    const s0 = Math.max(0, from - ANCHOR_BYTES)
    let b = below.get(key)
    below.delete(key) // put back below when up to date (most recent last)
    let above: Buffer = Buffer.alloc(0)
    let known: Buffer = Buffer.alloc(0) // bytes just before b.end, still the same
    let fresh: Buffer = Buffer.alloc(0) // bytes from b.end
    // whole: one hash of the bytes from b.start, checked, then extended with
    // the new ones.
    let sum: Hash | null = null
    const c0 = b ? (w.whole ? b.start : Math.max(b.start, b.end - CHECK_BYTES)) : 0
    if (b && b.ino === ino && size >= b.end) {
      if (c0 - from <= CHECK_BYTES) {
        const buf = await fs.read(file, s0, size - s0)
        above = buf.subarray(0, from - s0)
        known = buf.subarray(c0 - s0, b.end - s0)
        fresh = buf.subarray(b.end - s0)
      } else {
        above = await fs.read(file, s0, from - s0)
        const buf = await fs.read(file, c0, size - c0)
        known = buf.subarray(0, b.end - c0)
        fresh = buf.subarray(b.end - c0)
      }
      // Rewritten, cut or replaced since: read again from the cursor.
      sum = w.whole ? createHash('sha1').update(known) : null
      const check = sum ? sum.copy().digest('hex').slice(0, 12) : anchorHash(known)
      if (above.length !== from - s0 || known.length !== b.end - c0 || anchorHash(above) !== b.above || check !== b.check) b = undefined
    }
    if (!b || b.ino !== ino || size < b.end) {
      const buf = await fs.read(file, s0, size - s0)
      above = buf.subarray(0, from - s0)
      let off = from - s0
      if (from > 0 && above[above.length - 1] !== 0x0a) {
        const nl = buf.indexOf(0x0a, off)
        off = nl < 0 ? buf.length : nl + 1
      }
      known = Buffer.alloc(0)
      sum = w.whole ? createHash('sha1') : null
      b = { ino, start: s0 + off, end: s0 + off, above: anchorHash(above), aligned: off === from - s0, check: anchorHash(known), state: w.bottom() }
      fresh = buf.subarray(off)
    }
    const nl = fresh.lastIndexOf(0x0a)
    if (nl >= 0) {
      b.state.feed(fresh.subarray(0, nl).toString('utf8'), b.end)
      b.end += nl + 1
      // From c0 (or the start) to the new end: covers the bytes to check next time.
      if (sum) b.check = sum.update(fresh.subarray(0, nl + 1)).digest('hex').slice(0, 12)
      else {
        const tail = Buffer.concat([known, fresh.subarray(0, nl + 1)])
        b.check = anchorHash(tail.subarray(Math.max(0, tail.length - CHECK_BYTES)))
      }
    }
    below.set(key, b)
    let kept = 0
    for (const x of below.values()) kept += x.state.kept()
    for (const [k, x] of below) {
      if (x === b || (below.size <= MAX_BELOW && kept <= MAX_KEPT_BYTES)) break
      below.delete(k)
      kept -= x.state.kept()
    }
    // A last line not ended yet is left for the next poll, unless it already
    // parses (written whole, its newline still to come): read the whole
    // bottom for this poll, as before.
    const partial = fresh.subarray(nl + 1)
    if (partial.length) {
      const line = partial.toString('utf8')
      try { JSON.parse(w.reduce ? w.reduce(line) : line); return await readSlice(file, size, from, w) }
      catch { /* incomplete: ignored as the parsers would */ }
    }
    return { start: from, parsed: b.state.result(), anchor: b.aligned ? b.above : '' }
  }

  // Bottom of the conversation: from `from` (already shown on the phone) or,
  // on first load, the last pageItems messages. Cached by
  // (file, label, size, generation, from), when read once the state settled.
  // Reads in progress are shared: several devices on one pane cost one read
  // and one parse per change.
  const parseCache = new Map<string, { size: number, gen: string, settled: boolean, r: BottomRead<W> }>()
  const tailReads = new Map<string, Promise<BottomRead<W>>>()
  async function tail(file: string, w: WindowReader<W>, size: number, gen: string, from: number | null, settled = true, ino?: number): Promise<BottomRead<W>> {
    const key = `${file}|${w.label}|${from}`
    const c = parseCache.get(key)
    if (c && c.settled && c.size === size && c.gen === gen) return c.r
    const flight = `${key}|${size}|${gen}`
    let read = tailReads.get(flight)
    if (!read) {
      read = readTail(file, size, from, ino, w).finally(() => { tailReads.delete(flight) })
      tailReads.set(flight, read)
    }
    const r = await read
    parseCache.set(key, { size, gen, settled, r })
    if (parseCache.size > 16) parseCache.delete(parseCache.keys().next().value!)
    return r
  }
  async function readTail(file: string, size: number, from: number | null, ino: number | undefined, w: WindowReader<W>): Promise<BottomRead<W>> {
    if (from !== null && from <= size && size - from <= maxBytes) {
      return await locked(`${file}|${w.label}|${from}`, () => readBelow(file, size, from, ino, w))
    }
    const r = await readBackwards(file, size, w)
    return { ...r, anchor: await anchorAt(file, r.start) }
  }

  return { readRange, anchorAt, readBackwards, readSlice, readBelow, tail, readTail }
}

export type BoundedReads<W> = ReturnType<typeof createBoundedReads<W>>
