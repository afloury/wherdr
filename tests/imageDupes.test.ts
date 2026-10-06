// Tool images that repeat an image already shown higher up (shared/imageDupes.ts),
// from hashes computed by parseLines for omp, Claude and Codex.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'
import { addUploadHashes } from '../server/utils/uploadHashes'
import { duplicateImages } from '../shared/imageDupes'
import type { ChatItem } from '../shared/types'

const j = (o: object) => JSON.stringify(o)
const HOME = '/home/user'
// Which tool images end up as a "same image as above" mention, by tool target.
const dupeTools = (items: ChatItem[]) => {
  const dupes = duplicateImages(items)
  return items.filter(i => i.role === 'tool' && i.images).map(i => dupes.has(`${i.ref}:${i.imageAt || 0}`))
}

describe('duplicate images', () => {
  it('omp: a photo sent from wherdr (path line) that the agent reads back, re-encoded, is a mention', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hw-up-'))
    writeFileSync(path.join(dir, '2026-01-01T00-00-00-000Z-aaaaaa.jpg'), 'photo bytes')
    const up = `${HOME}/.cache/herdr-web/uploads/2026-01-01T00-00-00-000Z-aaaaaa.jpg`
    const msg = (message: object, ts: string) => j({ type: 'message', id: ts, timestamp: ts, message })
    const read = (id: string, p: string, ts: string) => msg({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'read', arguments: { path: p } }] }, ts)
    // omp's read returns the photo as WebP: not the bytes that were sent.
    const result = (id: string, hash: string, ts: string) => msg({ role: 'toolResult', toolCallId: id, content: [{ type: 'image', mimeType: 'image/webp', data: `blob:sha256:${hash}` }] }, ts)
    const text = [
      msg({ role: 'user', content: [{ type: 'text', text: `look\n${up}` }], attribution: 'user' }, '1'),
      read('r1', up, '2'), result('r1', 'ab'.repeat(32), '3'),
      read('r2', '/x/other.png', '4'), result('r2', 'cd'.repeat(32), '5'),
    ].join('\n')
    const items = parseLines(text, 'omp', 0, HOME)
    await addUploadHashes(items, dir)
    expect(dupeTools(items)).toEqual([true, false])
  })

  it('omp: the user\'s photo read back and a file read twice become mentions, another image stays', () => {
    const photo = 'ab'.repeat(32)
    const other = 'cd'.repeat(32)
    const msg = (message: object, ts: string) => j({ type: 'message', id: ts, timestamp: ts, message })
    const read = (id: string, p: string, ts: string) => msg({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'read', arguments: { path: p } }] }, ts)
    const result = (id: string, hash: string, ts: string) => msg({ role: 'toolResult', toolCallId: id, content: [{ type: 'image', mimeType: 'image/jpeg', data: `blob:sha256:${hash}` }] }, ts)
    const text = [
      msg({ role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', mimeType: 'image/jpeg', data: `blob:sha256:${photo}` }], attribution: 'user' }, '1'),
      read('r1', '/x/up.jpg', '2'), result('r1', photo, '3'),
      read('r2', '/x/b.png', '4'), result('r2', other, '5'),
      read('r3', '/x/b.png', '6'), result('r3', other, '7'),
    ].join('\n')
    const items = parseLines(text, 'omp', 0, HOME)
    expect(items.find(i => i.role === 'user')!.hashes).toEqual([photo])
    expect(dupeTools(items)).toEqual([true, false, true])
  })

  it('Claude: compares the bytes of base64 images, even on lines stripped before parsing', () => {
    const big = Buffer.alloc(60000, 7).toString('base64')
    const small = Buffer.from('other').toString('base64')
    const img = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })
    const use = (id: string) => j({ type: 'assistant', timestamp: 't', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/x/a.png' } }] } })
    const res = (id: string, data: string) => j({ type: 'user', timestamp: 't', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [img(data)] }] } })
    const text = [
      j({ type: 'user', timestamp: 't', message: { content: [{ type: 'text', text: 'look' }, img(big)] } }),
      use('u1'), res('u1', big),
      use('u2'), res('u2', small),
    ].join('\n')
    expect(dupeTools(parseLines(text, 'claude', 0, HOME))).toEqual([true, false])
  })

  it('Codex: an image a tool returns twice is a mention the second time', () => {
    const b64 = Buffer.from('shot').toString('base64')
    const call = (id: string) => j({ type: 'response_item', timestamp: 't', payload: { type: 'function_call', name: 'view_image', call_id: id, arguments: '{"path":"/x/a.png"}' } })
    const out = (id: string) => j({ type: 'response_item', timestamp: 't', payload: { type: 'function_call_output', call_id: id, output: [{ type: 'input_image', image_url: `data:image/png;base64,${b64}` }] } })
    expect(dupeTools(parseLines([call('c1'), out('c1'), call('c2'), out('c2')].join('\n'), 'codex'))).toEqual([false, true])
  })

  it('never hides a user\'s own images', () => {
    const items: ChatItem[] = [
      { role: 'user', text: '', ts: null, images: 1, ref: '0:1', hashes: ['h'] },
      { role: 'user', text: '', ts: null, images: 1, ref: '2:1', hashes: ['h'] },
    ]
    expect(duplicateImages(items).size).toBe(0)
  })
})
