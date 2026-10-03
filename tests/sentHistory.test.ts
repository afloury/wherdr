// Cancel / Stop of a message with photos once wherdr's "queued" record is gone:
// the sent history gives back its photo and file paths (Claude Code only keeps
// "[Image #1]"), the app shows them on Claude's own queue entries, and photos
// nobody knows are counted as lost instead of being silently dropped.
import { describe, expect, it } from 'vitest'
import { SENT_MAX, SENT_TTL_MS, addSent, findSent, hasAttachments, lostPhotos } from '../server/utils/sentHistory'
import { pendingQueue } from '../app/utils/pendingQueue'

const UP = '/home/user/.cache/herdr-web/uploads'
const A = `${UP}/2026-01-01T10-00-00-000Z-a.jpg`
const B = `${UP}/2026-01-01T10-00-01-000Z-b.png`
const FILE = '@/home/user/.cache/herdr-web/files/2026-01-01T10-00-02-000Z-notes.md'
const T0 = Date.parse('2026-01-01T10:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('sent history', () => {
  it('only messages with photos or files are remembered', () => {
    let h = addSent([], 'plain text', T0)
    expect(h).toEqual([])
    h = addSent(h, `Look\n${A}`, T0)
    h = addSent(h, `Notes\n${FILE}`, T0 + 1)
    expect(h.map(r => r.text)).toEqual([`Look\n${A}`, `Notes\n${FILE}`])
    expect(hasAttachments(FILE)).toBe(true)
    expect(hasAttachments('no path here')).toBe(false)
  })
  it('bounded in number and in time', () => {
    let h = addSent([], `old\n${A}`, T0)
    for (let i = 0; i < SENT_MAX + 5; i++) h = addSent(h, `m${i}\n${A}`, T0 + 1000 + i)
    expect(h.length).toBe(SENT_MAX)
    expect(h.some(r => r.text.startsWith('old'))).toBe(false)
    expect(addSent(h, `new\n${B}`, T0 + SENT_TTL_MS + 5000).map(r => r.text)).toEqual([`new\n${B}`])
  })
})

describe('the sent message behind a Claude record', () => {
  const h = [
    { text: `Look at this\n${A}`, at: T0 },
    { text: `Look at this one too\n${A}\n${B}`, at: T0 + 2000 },
    { text: B, at: T0 + 4000 },
  ]
  it('same text, enough photos', () => {
    expect(findSent(h, { text: 'Look at this', images: 1 }, T0 + 10000)?.text).toBe(`Look at this\n${A}`)
    expect(findSent(h, { text: '[Image #3]Look at this one too', images: 2 }, T0 + 10000)?.text).toBe(`Look at this one too\n${A}\n${B}`)
    expect(findSent(h, { text: 'Something else', images: 1 }, T0 + 10000)).toBeNull()
  })
  it('photos only: by number of photos, never a wrong count', () => {
    expect(findSent(h, { text: '', images: 1 }, T0 + 10000)?.text).toBe(B)
    expect(findSent(h, { text: '', images: 3 }, T0 + 10000)).toBeNull()
    expect(findSent(h, { text: '', images: 0 }, T0 + 10000)).toBeNull()
  })
  it('never a message sent after the record, never one already given', () => {
    expect(findSent(h, { text: '', images: 1, ts: iso(T0 - 60000) }, T0 + 10000)).toBeNull()
    const taken = [h[2]!]
    expect(findSent(h, { text: '', images: 1 }, T0 + 10000, taken)).toBeNull()
  })
  it('expired: unknown', () => {
    expect(findSent(h, { text: 'Look at this', images: 1 }, T0 + SENT_TTL_MS + 5000)).toBeNull()
  })
  it('lost photos: those the text given back does not carry', () => {
    expect(lostPhotos(2, `x\n${A}`)).toBe(1)
    expect(lostPhotos(1, `x\n${A}`)).toBe(0)
    expect(lostPhotos(1, 'x')).toBe(1)
    expect(lostPhotos(undefined, null)).toBe(0)
  })
})

describe('Claude queue entries in the app', () => {
  const base = { mine: [], items: [], screen: null }
  it('an entry with photos known by the server: thumbnails, and Cancel sends the paths', () => {
    const [q] = pendingQueue({ ...base, claude: [{ text: 'Look at this', ts: iso(T0), images: 1, sent: `Look at this\n${A}` }] })
    expect(q).toMatchObject({ raw: `Look at this\n${A}`, mine: false, photos: ['2026-01-01T10-00-00-000Z-a.jpg'], missing: 0 })
  })
  it('photos only known by the server: a bubble that can be cancelled', () => {
    const [q] = pendingQueue({ ...base, claude: [{ text: '', ts: iso(T0), images: 1, sent: A }] })
    expect(q).toMatchObject({ raw: A, missing: 0 })
  })
  it('unknown photos: shown as missing, the text alone comes back', () => {
    const [q] = pendingQueue({ ...base, claude: [{ text: 'Screenshot', ts: iso(T0), images: 1 }] })
    expect(q).toMatchObject({ raw: 'Screenshot', missing: 1, photos: [] })
  })
})
