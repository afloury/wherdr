import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createChatDelta, splitToken } from '../server/utils/chatDelta'
import { createTranscripts } from '../server/utils/transcripts'
import { nextTail, tailQuery } from '../app/utils/chatTail'
import type { ChatItem } from '../shared/types'

const item = (text: string, role: ChatItem['role'] = 'assistant'): ChatItem => ({ role, text, ts: '2026-01-01T00:00:00Z' })

describe('chatDelta', () => {
  it('sends the whole list to a client it does not know, then only what changed', () => {
    const d = createChatDelta()
    const a = [item('one', 'user'), item('two'), item('three')]
    const first = d.reply('p', 'f:100:0', a, '', null, true)
    expect(first.keep).toBeUndefined()
    expect(first.items).toBe(a)
    expect(splitToken(first.token)).toEqual({ base: 'f:100:0', fp: expect.stringMatching(/^[0-9a-f]{16}$/) })

    // One reply added, and the last one rewritten (the agent kept writing).
    const b = [a[0]!, a[1]!, item('three, longer'), item('four')]
    const next = d.reply('p', 'f:180:0', b, first.token, 3, true)
    expect(next.keep).toBe(2)
    expect(next.items).toEqual([item('three, longer'), item('four')])
    expect(nextTail(a, next)).toEqual(b)
  })

  it('falls back to the whole list when the client list is not the one it remembers', () => {
    const d = createChatDelta()
    const a = [item('one'), item('two')]
    const first = d.reply('p', 'f:10:0', a, '', null, true)
    const b = [...a, item('three')]
    expect(d.reply('p', 'f:20:0', b, first.token, 5, true).keep).toBeUndefined() // other count
    expect(d.reply('p', 'f:20:0', b, first.token, 2, false).keep).toBeUndefined() // other start
    expect(d.reply('p2', 'f:20:0', b, first.token, 2, true).keep).toBeUndefined() // other pane
    expect(d.reply('p', 'f:20:0', b, 'f:10:0', 2, true).keep).toBeUndefined() // token without fingerprint
    expect(d.reply('p', 'f:20:0', b, 'f:10:0#0123456789abcdef', 2, true).keep).toBeUndefined() // unknown list
    d.forget('p')
    expect(d.reply('p', 'f:20:0', b, first.token, 2, true).keep).toBeUndefined() // forgotten
  })

  it('tells apart two lists sent under the same transcript token', () => {
    // Same file and size, different content (a pasted text recognised later).
    const d = createChatDelta()
    const x = d.reply('p', 'f:10:0', [item('a', 'user')], '', null, true)
    const y = d.reply('p', 'f:10:0', [{ ...item('a', 'user'), pasted: ['a'] }], '', null, true)
    expect(x.token).not.toBe(y.token)
    const z = d.reply('p', 'f:20:0', [{ ...item('a', 'user'), pasted: ['a'] }, item('b')], x.token, 1, true)
    expect(z.keep).toBe(0) // the client holding x gets its first item again
  })

  it('keeps a bounded number of lists per pane', () => {
    const d = createChatDelta()
    const tokens = Array.from({ length: 6 }, (_, k) => d.reply('p', `f:${k}:0`, [item(String(k))], '', null, true).token)
    expect(d.reply('p', 'f:9:0', [item('0'), item('x')], tokens[0]!, 1, true).keep).toBeUndefined()
    expect(d.reply('p', 'f:9:0', [item('5'), item('x')], tokens[5]!, 1, true).keep).toBe(1)
  })
})

describe('nextTail and tailQuery', () => {
  it('splices an incremental reply and refuses one that does not fit', () => {
    const tail = [item('a'), item('b')]
    expect(nextTail(tail, { items: [item('c')] })).toEqual([item('c')])
    expect(nextTail(tail, { keep: 1, items: [item('c')] })).toEqual([item('a'), item('c')])
    expect(nextTail(tail, { keep: 1, items: [item('c')] })![0]).toBe(tail[0])
    expect(nextTail(tail, { keep: 2, items: [] })).toBe(tail)
    expect(nextTail(tail, { keep: 3, items: [] })).toBeNull()
    expect(nextTail(tail, { keep: -1, items: [] })).toBeNull()
  })

  it('sends the item count only with a token and a known start', () => {
    expect(Object.fromEntries(tailQuery('w1:p1', { token: '', tailStart: null, tail: [] }))).toEqual({ pane: 'w1:p1', since: '' })
    expect(Object.fromEntries(tailQuery('w1:p1', { token: '', tailStart: 0, tail: [item('a')] }))).toEqual({ pane: 'w1:p1', since: '', from: '0' })
    expect(Object.fromEntries(tailQuery('w1:p1', { token: 't#x', tailStart: 40, tail: [item('a')] }))).toEqual({ pane: 'w1:p1', since: 't#x', from: '40', n: '1' })
  })
})

// End to end on a real transcript file: what the client rebuilds from the
// incremental replies is exactly the list a full re-read gives.
describe('incremental re-read of a Claude transcript', () => {
  const homes: string[] = []
  afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }) })
  const noHerdr = async () => { throw new Error('no Herdr') }
  let n = 0
  const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString()
  const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text }, timestamp: at() })
  const said = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content }, timestamp: at() })
  const reply = (k: number) => said([{ type: 'text', text: `Reply ${k}:\n\n- a point\n- another point\n\n\`\`\`js\nconst x = ${k}\n\`\`\`\n\nShall I go on?` }])
  const result = (id: string, text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] }, timestamp: at() })

  function setup(messages: number) {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-delta-'))
    homes.push(home)
    const dir = path.join(home, '.claude/projects/-x')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'abc-123.jsonl')
    const lines: string[] = []
    for (let k = 0; k < messages / 2; k++) lines.push(user(`Question ${k}`), reply(k))
    writeFileSync(file, lines.join('\n') + '\n')
    const t = createTranscripts({ home, herdr: noHerdr })
    const pane = { id: 'w1:p1', agent: 'claude', cwd: '/x', agentSession: 'abc-123' }
    const d = createChatDelta()
    // What /api/chat does with the transcript's reply (server/api/chat.get.ts).
    const call = async (since: string, from: number | null, count: number | null) => {
      const r = await t.chat(pane, { since: splitToken(since).base, from })
      if (r.unchanged || !r.items) return { ...r, token: since }
      return { ...r, ...d.reply(pane.id, r.token!, r.items, since, count, from !== null && r.start === from) }
    }
    return { file, t, pane, call }
  }

  it('sends one new message instead of the whole conversation, and rebuilds the same list', async () => {
    const { file, call } = setup(2000)
    const first = await call('', null, null)
    expect(first.items!.length).toBe(2000)
    let tail = first.items!
    let token = first.token!
    const start = first.start!
    const sizes: number[] = []

    // A tool call, its result (which changes the call already sent), then replies.
    const steps = [
      said([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
      result('toolu_1', 'a\nb'),
      reply(1000),
      user('Thanks'),
    ]
    for (const line of steps) {
      appendFileSync(file, line + '\n')
      const r = await call(token, start, tail.length)
      expect(r.keep).toBeDefined()
      sizes.push(JSON.stringify(r).length)
      tail = nextTail(tail, r)!
      token = r.token!
      const full = await call('', start, null)
      expect(tail).toEqual([...full.items!])
    }
    const fullSize = JSON.stringify(await call('', start, null)).length
    // Whole conversation each time before; a few hundred bytes now.
    expect(fullSize).toBeGreaterThan(150_000)
    for (const s of sizes) expect(s).toBeLessThan(2_000)
    // The tool call sent at step 1 comes again once its result is in.
    expect(tail.find(i => i.role === 'tool' && i.name === 'Bash')).toBeTruthy()
  })

  it('falls back to a full reply when the file was rewritten shorter than the start', async () => {
    const { file, call } = setup(20)
    const first = await call('', null, null)
    // A first load that started mid-file (as after paging): pretend start was further down.
    writeFileSync(file, user('Fresh start') + '\n')
    const r = await call(first.token!, 5000, first.items!.length)
    expect(r.keep).toBeUndefined()
    expect(r.start).not.toBe(5000) // the client sees another start and reloads from the bottom
  })
})
