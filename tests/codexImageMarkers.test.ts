// Image markers of Codex user messages. Codex (codex-rs/protocol models.rs)
// writes each attached local image as three content parts:
//   { input_text: '<image name=[Image #1] path="…">' }, { input_image }, { input_text: '</image>' }
// (older versions: '<image name=[Image #1]>'), then the user's text, which
// keeps the composer's "[Image #1]" placeholder. Only those parts, in that
// context, are metadata: anything the user wrote stays.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranscripts, parseLines } from '../server/utils/transcripts'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const UPLOADS = '/home/user/.cache/herdr-web/uploads'
const j = (o: object) => JSON.stringify(o)
const text = (t: string) => ({ type: 'input_text', text: t })
const image = { type: 'input_image', image_url: PNG, detail: 'high' }
// One local image as Codex writes it.
const local = (n: number, name = `photo-${n}.jpg`) => [text(`<image name=[Image #${n}] path="${UPLOADS}/${name}">`), image, text('</image>')]
const user = (content: object[], ts = '2026-01-01T00:00:00Z') => j({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'user', content } })
const assistant = (t: string, ts = '2026-01-01T00:00:01Z') => j({ timestamp: ts, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t }] } })
const codex = (...lines: string[]) => parseLines(lines.join('\n') + '\n', 'codex')
const users = (...lines: string[]) => codex(...lines).filter(i => i.role === 'user')

describe('Codex image markers', () => {
  it('an image alone leaves no text, only the image', () => {
    const [m] = users(user([...local(1), text('[Image #1]')]))
    expect(m).toMatchObject({ text: '', images: 1 })
    expect(m!.ref).toMatch(/^\d+:\d+$/)
  })

  it('several images alone leave no text', () => {
    const [m] = users(user([...local(1), ...local(2), ...local(3), text('[Image #1][Image #2] [Image #3]')]))
    expect(m).toMatchObject({ text: '', images: 3 })
  })

  it('the older open tag (no path) and placeholders on their own lines', () => {
    const [m] = users(user([text('<image name=[Image #1]>'), image, text('</image>'), text('<image name=[Image #2]>'), image, text('</image>'), text('[Image #1]\n[Image #2]\n')]))
    expect(m).toMatchObject({ text: '', images: 2 })
  })

  it('a remote image wrapped in <image></image> leaves no text', () => {
    const [m] = users(user([text('<image>'), image, text('</image>'), text('Compare it.')]))
    expect(m).toMatchObject({ text: 'Compare it.', images: 1 })
  })

  it('keeps the text written before, between and after the images', () => {
    expect(users(user([...local(1), text('Here is the bug:\n[Image #1]')]))[0]!.text).toBe('Here is the bug:')
    expect(users(user([...local(1), text('[Image #1]\nWhy is the button clipped?')]))[0]!.text).toBe('Why is the button clipped?')
    expect(users(user([...local(1), ...local(2), text('Before [Image #1] and after [Image #2] the change.')]))[0]!.text).toBe('Before and after the change.')
    expect(users(user([...local(1), ...local(2), text('First:\n[Image #1]\n\nThen:\n[Image #2]\n\nWhich one is right?')]))[0]!.text).toBe('First:\n\nThen:\n\nWhich one is right?')
  })

  it('keeps the upload path out of the text (the image is re-read from the transcript)', () => {
    const [m] = users(user([...local(1, 'shot.jpg'), text('[Image #1]')]))
    expect(m!.text).not.toContain('uploads')
    expect(m!.text).not.toContain('path=')
  })

  it('keeps literal markers the user typed', () => {
    // No image: nothing to strip.
    expect(users(user([text('Wrap it like this:\n```html\n<image name=[Image #1]>\n</image>\n```')]))[0]!.text).toBe('Wrap it like this:\n```html\n<image name=[Image #1]>\n</image>\n```')
    expect(users(user([text('</image>')]))[0]!.text).toBe('</image>')
    expect(users(user([text('See [Image #1] in the spec.')]))[0]!.text).toBe('See [Image #1] in the spec.')
    // With an image: only its own placeholder goes, once.
    expect(users(user([...local(1), text('[Image #1] shows that "[Image #1]" and [Image #2] are labels; `</image>` closes.')]))[0]!.text)
      .toBe('shows that "[Image #1]" and [Image #2] are labels; `</image>` closes.')
    // A "</image>" part not right after an image is the user's.
    expect(users(user([...local(1), text('</image>'), text('[Image #1]')]))[0]!.text).toBe('</image>')
  })

  it('leaves replies alone', () => {
    const r = codex(assistant('Use `</image>` and [Image #1] as written.')).find(i => i.role === 'assistant')!
    expect(r.text).toBe('Use `</image>` and [Image #1] as written.')
  })

  it('counts images and keeps their order for re-reading', () => {
    const [m] = users(user([...local(1), ...local(2), text('Two shots.')]))
    expect(m).toMatchObject({ text: 'Two shots.', images: 2 })
    expect(m!.hashes).toHaveLength(2)
  })
})

describe('Claude and omp image tags are unchanged', () => {
  it('Claude: "[Image #1]" goes, the text stays', () => {
    const line = j({ type: 'user', timestamp: 't', message: { role: 'user', content: [
      { type: 'text', text: '[Image #1] What is wrong here?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG.split(',')[1] } },
    ] } })
    const [m] = parseLines(line + '\n', 'claude', 0, '/home/user').filter(i => i.role === 'user')
    expect(m).toMatchObject({ text: 'What is wrong here?', images: 1 })
  })

  it('Claude: a text with "</image>" and no image stays as typed', () => {
    const line = j({ type: 'user', timestamp: 't', message: { role: 'user', content: 'Close it with </image>.' } })
    expect(parseLines(line + '\n', 'claude', 0, '/home/user').find(i => i.role === 'user')!.text).toBe('Close it with </image>.')
  })

  it('omp: "[Image #1, 756x477]" goes, the text stays', () => {
    const line = j({ type: 'message', id: 'a', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: [
      { type: 'text', text: '[Image #1, 756x477] Is this aligned?' },
      { type: 'image', mimeType: 'image/png', data: PNG.split(',')[1] },
    ] } })
    const [m] = parseLines(line + '\n', 'omp', 0, '/home/user').filter(i => i.role === 'user')
    expect(m).toMatchObject({ text: 'Is this aligned?', images: 1 })
  })
})

describe('Codex image markers through the chat API', () => {
  // A rollout long enough to read in pages: the photo-only message sits in
  // the older slice, a text + photo message in the latest one.
  const home = mkdtempSync(path.join(tmpdir(), 'hw-codex-img-'))
  const dir = path.join(home, '.codex/sessions/2026/01/01')
  mkdirSync(dir, { recursive: true })
  const id = '00000000-0000-4000-8000-0000000001a9'
  const filler = Array.from({ length: 120 }, (_, k) => [
    user([text(`Step ${k}: ${'details '.repeat(2500)}`)], `2026-01-01T00:${String(10 + Math.floor(k / 60)).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}Z`),
    assistant(`Done ${k}.`, `2026-01-01T00:${String(10 + Math.floor(k / 60)).padStart(2, '0')}:${String(k % 60).padStart(2, '0')}Z`),
  ]).flat()
  const lines = [
    j({ type: 'session_meta', payload: { id, cwd: '/home/user/acme-shop' } }),
    user([...local(1)], '2026-01-01T00:00:00Z'),
    user([...local(1), text('[Image #1]')], '2026-01-01T00:01:00Z'),
    assistant('A login page.', '2026-01-01T00:01:05Z'),
    ...filler,
    user([...local(1), ...local(2), text('Before [Image #1] and [Image #2] after.')], '2026-01-01T01:00:00Z'),
    assistant('Both differ.', '2026-01-01T01:00:05Z'),
  ]
  writeFileSync(path.join(dir, `rollout-2026-01-01T00-00-00-${id}.jsonl`), lines.join('\n') + '\n')
  const t = createTranscripts({ home, herdr: async () => { throw new Error('no Herdr in tests') } })
  const pane = { id: 'w1:p1', agent: 'codex', cwd: '/home/user/acme-shop', agentSession: id }
  const photoMsgs = (items: { role: string, text: string, images?: number }[]) => items.filter(i => i.role === 'user' && i.images)

  it('initial load: text kept, markers gone, images re-readable', async () => {
    const r = await t.chat(pane, {})
    expect(r.available).toBe(true)
    const last = photoMsgs(r.items!).at(-1)!
    expect(last).toMatchObject({ text: 'Before and after.', images: 2 })
    expect((await t.image(pane, r.file!, (last as { ref: string }).ref, 1))!.type).toBe('image/png')
  })

  it('history: the older photo-only messages come back without markers', async () => {
    const first = await t.chat(pane, {})
    expect(first.start).toBeGreaterThan(0)
    expect(photoMsgs(first.items!).map(i => i.text)).toEqual(['Before and after.'])
    let start = first.start!
    let found: { text: string, images?: number }[] = []
    for (let n = 0; n < 20 && start > 0 && !found.length; n++) {
      const older = await t.chat(pane, { before: start })
      expect(older.older).toBe(true)
      found = photoMsgs(older.items!).filter(i => i.text === '' || /image|Image #/.test(i.text))
      start = older.start!
    }
    expect(found.map(i => [i.text, i.images])).toEqual([['', 1], ['', 1]])
  })
})
