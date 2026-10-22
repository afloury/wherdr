// A message sent to Claude during a turn, then lost before Claude read it,
// and a message never seen in the conversation: reported as not sent, with
// Retry / Cancel, instead of staying "queued" (until the turn ends, or an
// hour, after which its bubble used to vanish).
// Queue operations as Claude Code 2.1.307 writes them (Herdr test session):
// a message typed during a turn is enqueued at once; ↑ in its input field
// pulls the queue back into it with one `popAll` per entry.
import { describe, expect, it } from 'vitest'
import type { ClaudeQueueEntry } from '../shared/types'
import { FAILED_TTL_MS, LOST_MS, QUEUED_TTL_MS, type QueueEntry, checkQueue, checkSent, loadQueued, publicEntry } from '../server/utils/queued'
import { parseLines } from '../server/utils/transcripts'

const T0 = Date.parse('2026-10-22T02:13:36.000Z')
const iso = (t: number) => new Date(t).toISOString()
const op = (operation: string, t: number, content?: string) => JSON.stringify({ type: 'queue-operation', operation, timestamp: iso(t), ...(content === undefined ? {} : { content }) })
const read = (lines: string[]) => {
  const r = parseLines(lines.join('\n'), 'claude', 0, '/home/user')
  return { queue: r.queue || [], popped: r.popped || [] }
}
const sent = (x: Partial<QueueEntry> = {}): QueueEntry => ({ id: 'm1', text: 'queued probe four', at: T0, typedAt: T0, ...x })

describe('Claude\'s transcript: entries pulled back out of its queue', () => {
  it('lists a popAll not followed by the same entry queued again', () => {
    expect(read([op('enqueue', T0 + 600, 'queued probe four'), op('popAll', T0 + 7500, 'queued probe four')]))
      .toEqual({ queue: [], popped: [{ text: 'queued probe four', ts: iso(T0 + 7500) }] })
  })

  it('forgets it once queued again (Enter in the terminal, or wherdr\'s Cancel of another message)', () => {
    const r = read([
      op('enqueue', T0 + 600, 'first'), op('enqueue', T0 + 900, 'second'),
      op('popAll', T0 + 5000, 'first'), op('popAll', T0 + 5000, 'second'),
      op('enqueue', T0 + 6000, 'second'),
    ])
    expect(r.queue.map(q => q.text)).toEqual(['second'])
    expect(r.popped.map(q => q.text)).toEqual(['first'])
  })

  it('a message taken normally is never listed', () => {
    expect(read([op('enqueue', T0 + 600, 'next'), op('dequeue', T0 + 9000)]).popped).toEqual([])
  })
})

describe('checkSent', () => {
  const claude = (queue: ClaudeQueueEntry[], popped: ClaudeQueueEntry[] = []) => ({ queue, popped })
  const pulled = [{ text: 'queued probe four', ts: iso(T0 + 7500) }]

  it('fails a message pulled out of Claude\'s queue after LOST_MS, during the turn', () => {
    const list = [sent()]
    expect(checkSent(list, { agent: 'claude', claude: claude([], pulled), now: T0 + 8000 })).toBe(false)
    expect(list[0]).toMatchObject({ popped: true, lostSince: T0 + 8000 })
    expect(checkSent(list, { agent: 'claude', claude: claude([], pulled), now: T0 + 8000 + LOST_MS })).toBe(false)
    expect(checkSent(list, { agent: 'claude', claude: claude([], pulled), now: T0 + 8001 + LOST_MS })).toBe(true)
    expect(list[0]).toMatchObject({ failed: true, lost: true })
    expect(list[0]!.lostSince).toBeUndefined()
    expect(publicEntry(list[0]!)).toMatchObject({ state: 'failed', reason: 'lost' })
  })

  it('keeps the reason when the turn ends first and the idle check fails it', () => {
    const list = [sent()]
    checkSent(list, { agent: 'claude', claude: claude([], pulled), now: T0 + 8000 })
    checkQueue(list, 'done', T0 + 9000, false)
    expect(checkQueue(list, 'done', T0 + 9001 + LOST_MS, false)).toBe(true)
    expect(publicEntry(list[0]!)).toMatchObject({ state: 'failed', reason: 'lost' })
  })

  it('remembers the pull once the tail read no longer shows it', () => {
    const list = [sent()]
    checkSent(list, { agent: 'claude', claude: claude([], pulled), now: T0 + 8000 })
    expect(checkSent(list, { agent: 'claude', claude: claude([], []), now: T0 + 8001 + LOST_MS })).toBe(true)
    expect(list[0]!.lost).toBe(true)
  })

  it('keeps it while it is queued again, or when the pull is older than its sending', () => {
    const list = [sent()]
    checkSent(list, { agent: 'claude', claude: claude([], pulled), now: T0 + 8000 })
    checkSent(list, { agent: 'claude', claude: claude([{ text: 'queued probe four', ts: iso(T0 + 20000) }]), now: T0 + 21000 })
    expect(list[0]!.popped).toBeUndefined()
    expect(checkSent(list, { agent: 'claude', claude: claude([{ text: 'queued probe four', ts: iso(T0 + 20000) }]), now: T0 + 30 * 60 * 1000 })).toBe(false)
    // Same words sent earlier and pulled back then: not this message.
    const again = [sent({ at: T0 + 60000, typedAt: T0 + 60000 })]
    checkSent(again, { agent: 'claude', claude: claude([], pulled), now: T0 + 61000 })
    expect(again[0]!.popped).toBeUndefined()
  })

  it('never fails one for its absence alone from Claude\'s queue (an old enqueue may be out of the tail read)', () => {
    const list = [sent()]
    expect(checkSent(list, { agent: 'claude', claude: claude([]), now: T0 + 50 * 60 * 1000 })).toBe(false)
    expect(list[0]!.failed).toBeUndefined()
  })

  it('fails a message still not seen after an hour, as not seen, unless Claude still queues it', () => {
    const codex = [sent()]
    expect(checkSent(codex, { agent: 'codex', claude: null, now: T0 + QUEUED_TTL_MS })).toBe(false)
    expect(checkSent(codex, { agent: 'codex', claude: null, now: T0 + QUEUED_TTL_MS + 1 })).toBe(true)
    expect(publicEntry(codex[0]!)).toMatchObject({ state: 'failed', reason: 'unseen' })
    const queued = [sent()]
    expect(checkSent(queued, { agent: 'claude', claude: claude([{ text: 'queued probe four', ts: iso(T0 + 600) }]), now: T0 + 2 * QUEUED_TTL_MS })).toBe(false)
  })

  it('never takes a message for another one that contains it, or that it contains', () => {
    // Both pulled back, only the longer one queued again: the shorter one is lost.
    const r = read([
      op('enqueue', T0 + 600, 'review server'), op('enqueue', T0 + 900, 'review server and client'),
      op('popAll', T0 + 5000, 'review server'), op('popAll', T0 + 5000, 'review server and client'),
      op('enqueue', T0 + 6000, 'review server and client'),
    ])
    const short = sent({ text: 'review server' })
    const long = sent({ id: 'm2', text: 'review server and client' })
    const list = [short, long]
    checkSent(list, { agent: 'claude', claude: r, now: T0 + 7000 })
    expect(checkSent(list, { agent: 'claude', claude: r, now: T0 + 7001 + LOST_MS })).toBe(true)
    expect(short).toMatchObject({ failed: true, lost: true })
    expect(long.failed).toBeUndefined()
    // A longer message pulled back says nothing of a short one inside it.
    const ok = [sent({ text: 'ok' })]
    const pulledLong = read([op('enqueue', T0 + 600, 'look at tests, ok'), op('popAll', T0 + 5000, 'look at tests, ok')])
    checkSent(ok, { agent: 'claude', claude: pulledLong, now: T0 + 6000 })
    expect(ok[0]!.popped).toBeUndefined()
    expect(checkSent(ok, { agent: 'claude', claude: pulledLong, now: T0 + 6001 + LOST_MS })).toBe(false)
    // Spaces and line breaks aside, the same text is the same message.
    const lines = [sent({ text: 'first line\nsecond   line' })]
    checkSent(lines, { agent: 'claude', claude: read([op('enqueue', T0 + 600, 'first line\nsecond   line'), op('popAll', T0 + 5000, 'first line\nsecond   line')]), now: T0 + 6000 })
    expect(lines[0]!.popped).toBe(true)
  })

  it('a long message wherdr keeps cut is known by its start', () => {
    const full = `${'word '.repeat(1000)}end`
    const list = [sent({ text: full.slice(0, 4000) })]
    checkSent(list, { agent: 'claude', claude: read([op('enqueue', T0 + 600, full), op('popAll', T0 + 5000, full)]), now: T0 + 6000 })
    expect(list[0]!.popped).toBe(true)
  })

  it('leaves held and failed messages alone, photos alone matched by their images', () => {
    const list = [sent({ held: true }), sent({ id: 'f', failed: true })]
    expect(checkSent(list, { agent: 'claude', claude: claude([], pulled), now: T0 + 2 * QUEUED_TTL_MS })).toBe(false)
    const photos = [sent({ text: '/home/user/.cache/herdr-web/uploads/a.jpg' })]
    checkSent(photos, { agent: 'claude', claude: claude([], [{ text: '', ts: iso(T0 + 1000), images: 1 }]), now: T0 + 2000 })
    expect(photos[0]!.popped).toBe(true)
    const two = [sent({ text: '/home/user/.cache/herdr-web/uploads/a.jpg\n/home/user/.cache/herdr-web/uploads/b.jpg' })]
    checkSent(two, { agent: 'claude', claude: claude([], [{ text: '', ts: iso(T0 + 1000), images: 1 }]), now: T0 + 2000 })
    expect(two[0]!.popped).toBeUndefined()
  })
})

describe('loadQueued after a restart', () => {
  it('keeps a failed message up to FAILED_TTL_MS, with its reason', () => {
    const lost = sent({ failed: true, lost: true })
    expect(loadQueued({ 'w1:p1': [lost] }, T0 + 2 * QUEUED_TTL_MS)).toEqual([['w1:p1', [{ id: 'm1', text: 'queued probe four', at: T0, typedAt: T0, failed: true, lost: true }]]])
    expect(loadQueued({ 'w1:p1': [lost] }, T0 + FAILED_TTL_MS)).toEqual([])
  })

  it('reads a sent message older than an hour as not seen, an old held one as not sent', () => {
    const [[, list]] = loadQueued({ 'w1:p1': [sent(), sent({ id: 'h', held: true, turn: true, typedAt: undefined })] }, T0 + QUEUED_TTL_MS) as [[string, QueueEntry[]]]
    expect(list.map(publicEntry)).toEqual([
      { id: 'm1', text: 'queued probe four', at: T0, state: 'failed', reason: 'unseen' },
      { id: 'h', text: 'queued probe four', at: T0, state: 'failed' },
    ])
  })
})
