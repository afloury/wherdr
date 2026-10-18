import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createChatDelta, splitToken } from '../server/utils/chatDelta'
import { createTranscripts } from '../server/utils/transcripts'
import { createTailLoader, nextTail, tailQuery } from '../app/utils/chatTail'
import type { ChatItem } from '../shared/types'

const item = (text: string, role: ChatItem['role'] = 'assistant'): ChatItem => ({ role, text, ts: '2026-01-01T00:00:00Z' })

describe('chatDelta', () => {
  it('sends the whole list to a client it does not know, then only what changed', () => {
    const d = createChatDelta()
    const a = [item('one', 'user'), item('two'), item('three')]
    const first = d.reply('p', 'f:100:0', a, '', 0, true)
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
    const first = d.reply('p', 'f:10:0', a, '', 0, true)
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
    const x = d.reply('p', 'f:10:0', [item('a', 'user')], '', 0, true)
    const y = d.reply('p', 'f:10:0', [{ ...item('a', 'user'), pasted: ['a'] }], '', 0, true)
    expect(x.token).not.toBe(y.token)
    const z = d.reply('p', 'f:20:0', [{ ...item('a', 'user'), pasted: ['a'] }, item('b')], x.token, 1, true)
    expect(z.keep).toBe(0) // the client holding x gets its first item again
  })

  it('does not remember lists sent to readers that do not splice (no n)', () => {
    const d = createChatDelta()
    const x = d.reply('p', 'f:10:0', [item('a')], '', null, true)
    expect(d.knows('p', x.token, 1)).toBe(false)
    expect(d.reply('p', 'f:20:0', [item('a'), item('b')], x.token, 1, true).keep).toBeUndefined()
  })

  it('gives the transcript token only for a list it remembers with that count', () => {
    const d = createChatDelta()
    const x = d.reply('p', 'f:10:0', [item('a'), item('b')], '', 0, true)
    expect(d.sinceOf('p', x.token, 2)).toBe('f:10:0') // known: "unchanged" is allowed
    expect(d.sinceOf('p', x.token, 99999)).toBe('') // wrong count: full list
    expect(d.sinceOf('p', x.token, null)).toBe('')
    expect(d.sinceOf('p', 'f:10:0#0123456789abcdef', 2)).toBe('') // unknown fingerprint
    expect(d.sinceOf('p2', x.token, 2)).toBe('') // other pane
    expect(d.sinceOf('p', 'f:10:0', null)).toBe('f:10:0') // old token, without fingerprint
    expect(d.sinceOf('p', '', 0)).toBe('')
  })

  it('keeps a bounded number of lists per pane', () => {
    const d = createChatDelta()
    const tokens = Array.from({ length: 6 }, (_, k) => d.reply('p', `f:${k}:0`, [item(String(k))], '', 0, true).token)
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

  it('sends the item count of the list held (0 without a token)', () => {
    expect(Object.fromEntries(tailQuery('w1:p1', { token: '', tailStart: null, tail: [] }))).toEqual({ pane: 'w1:p1', since: '', n: '0' })
    expect(Object.fromEntries(tailQuery('w1:p1', { token: '', tailStart: 0, tail: [item('a')] }))).toEqual({ pane: 'w1:p1', since: '', from: '0', n: '0' })
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

  function setup(messages: number, pad = '') {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-delta-'))
    homes.push(home)
    const dir = path.join(home, '.claude/projects/-x')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'abc-123.jsonl')
    const lines: string[] = []
    for (let k = 0; k < messages / 2; k++) lines.push(user(`Question ${k}${pad}`), reply(k))
    writeFileSync(file, lines.join('\n') + '\n')
    const t = createTranscripts({ home, herdr: noHerdr })
    const pane = { id: 'w1:p1', agent: 'claude', cwd: '/x', agentSession: 'abc-123' }
    const d = createChatDelta()
    // What /api/chat does with the transcript's reply (server/api/chat.get.ts).
    const call = async (since: string, from: number | null, count: number | null) => {
      const r = await t.chat(pane, { since: d.sinceOf(pane.id, since, count), from })
      if (r.unchanged || !r.items) return { ...r, token: since }
      return { ...r, ...d.reply(pane.id, r.token!, r.items, since, count, from !== null && r.start === from) }
    }
    return { file, t, pane, call }
  }

  it('sends one new message instead of the whole conversation, and rebuilds the same list', async () => {
    const { file, call } = setup(2000)
    const first = await call('', null, 0)
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

  it('falls back to a full reply when the file became shorter than the start', async () => {
    const { file, call } = setup(20)
    const first = await call('', null, 0)
    // A first load that started mid-file (as after paging): pretend start was further down.
    writeFileSync(file, user('Fresh start') + '\n')
    const r = await call(first.token!, 5000, first.items!.length)
    expect(r.keep).toBeUndefined()
    expect(r.start).not.toBe(5000) // the client sees another start and reloads from the bottom
  })

  it('keeps the first message when the bottom starts past the first window (cursor > 0)', async () => {
    // About 3 MB: the first load reads back one 2 MB window and starts mid-file.
    const { file, call } = setup(6000, ` ${'x'.repeat(400)}`)
    const first = await call('', null, 0)
    const start = first.start!
    expect(start).toBeGreaterThan(0)
    const again = await call('', start, null)
    expect(again.start).toBe(start)
    expect([...again.items!]).toEqual([...first.items!]) // the first message is not lost
    appendFileSync(file, user('One more') + '\n')
    const r = await call(first.token!, start, first.items!.length)
    expect(r.keep).toBe(first.items!.length)
    expect(nextTail(first.items!, r)).toEqual([...(await call('', start, null)).items!])
  })

  it('answers an unknown token or a wrong count with the full list, never "unchanged"', async () => {
    const { call } = setup(20)
    const load = await call('', null, 0)
    const start = load.start!
    const first = await call(load.token!, start, load.items!.length) // first poll, from the start
    expect(first.keep).toBe(load.items!.length)
    const held = load.items!.length
    expect((await call(first.token!, start, held)).unchanged).toBe(true)
    const base = splitToken(first.token!).base
    for (const [since, count] of [[`${base}#0123456789abcdef`, held], [first.token!, 99999], [first.token!, null]] as const) {
      const r = await call(since, start, count)
      expect(r.unchanged).toBeFalsy()
      expect(r.keep).toBeUndefined()
      expect(r.items!.length).toBe(load.items!.length)
    }
  })
})

describe('createTailLoader', () => {
  const deferred = <T>() => {
    let resolve!: (v: T) => void
    const promise = new Promise<T>(r => { resolve = r })
    return { promise, resolve }
  }

  it('keeps the lock through re-runs: a polling tick starts no second request', async () => {
    const requests: { done: ReturnType<typeof deferred<string>> }[] = []
    let shown = ''
    const loader = createTailLoader(async (current) => {
      const done = deferred<string>()
      requests.push({ done })
      const reply = await done.promise
      if (!current()) return false
      if (reply === 'reset') return true // run again at once, lock held
      shown = reply
      return false
    })
    const first = loader.load()
    expect(requests.length).toBe(1)
    requests[0]!.done.resolve('reset')
    await new Promise(r => setTimeout(r, 0))
    expect(requests.length).toBe(2) // the re-run
    void loader.load() // polling ticks during the re-run
    void loader.load()
    expect(requests.length).toBe(2)
    requests[1]!.done.resolve('NEWER')
    await first
    expect(shown).toBe('NEWER')
    void loader.load() // free again afterwards
    expect(requests.length).toBe(3)
    requests[2]!.done.resolve('LATEST')
    await new Promise(r => setTimeout(r, 0))
    expect(shown).toBe('LATEST')
  })

  it('drops a reply that comes back after a newer one (resolved in reverse order)', async () => {
    const requests: ReturnType<typeof deferred<string>>[] = []
    let shown = ''
    const loader = createTailLoader(async (current) => {
      const done = deferred<string>()
      requests.push(done)
      const reply = await done.promise
      if (current()) shown = reply
      return false
    })
    const older = loader.load()
    loader.invalidate() // another pane: a new load may start at once
    const newer = loader.load()
    expect(requests.length).toBe(2)
    requests[1]!.resolve('NEWER')
    await newer
    requests[0]!.resolve('OLDER')
    await older
    expect(shown).toBe('NEWER')
    // The old load ending did not release the new generation's lock early.
    const again = loader.load()
    expect(requests.length).toBe(3)
    void loader.load()
    expect(requests.length).toBe(3)
    requests[2]!.resolve('LATEST')
    await again
    expect(shown).toBe('LATEST')
  })

  it('stops re-running after a few steps', async () => {
    let steps = 0
    const loader = createTailLoader(async () => { steps++; return true }, 3)
    await loader.load()
    expect(steps).toBe(3)
  })
})
