// Fewer transcript reads (server/utils/transcripts.ts): several devices on one
// pane share a read in progress, and card previews read the end of a long
// transcript first.
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTranscripts } from '../server/utils/transcripts'
import { type MachineFs, localFs } from '../server/utils/fsx'

const homes: string[] = []
afterEach(() => { for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true }) })
const noHerdr = async () => { throw new Error('no Herdr') }
let n = 0
const at = () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString()
const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text }, timestamp: at() })
const reply = (text: string) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }] }, timestamp: at() })
const pane = { id: 'w1:p1', agent: 'claude', cwd: '/x', agentSession: 'abc-123' }

// A transcript, and a file system that counts the bytes read from it.
function setup(lines: string[], now?: () => number) {
  const home = mkdtempSync(path.join(tmpdir(), 'hw-reads-'))
  homes.push(home)
  const dir = path.join(home, '.claude/projects/-x')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'abc-123.jsonl')
  writeFileSync(file, lines.join('\n') + '\n')
  const reads: number[] = []
  const fs: MachineFs = { ...localFs, read: async (p, start, len) => {
    const b = await localFs.read(p, start, len)
    if (p === file) reads.push(b.length)
    return b
  } }
  const t = createTranscripts({ home, herdr: noHerdr, fs, ...(now ? { now } : {}) })
  return { file, t, reads }
}

describe('shared transcript reads', () => {
  it('requests on the same pane and state read the file once', async () => {
    const { t, reads } = setup([user('Hello'), reply('Hi there')])
    const replies = await Promise.all([t.chat(pane), t.chat(pane), t.chat(pane)])
    for (const r of replies) expect(r.items!.map(i => i.text)).toEqual(['Hello', 'Hi there'])
    expect(reads.length).toBe(1)
  })

  it('a new state is read again', async () => {
    const { file, t, reads } = setup([user('Hello'), reply('Hi there')])
    await Promise.all([t.chat(pane), t.chat(pane)])
    appendFileSync(file, `${reply('More')}\n`)
    const [a, b] = await Promise.all([t.chat(pane), t.chat(pane)])
    expect(a.items!.at(-1)!.text).toBe('More')
    expect(b.items!.at(-1)!.text).toBe('More')
    expect(reads.length).toBe(2)
  })
})

describe('card preview of a long transcript', () => {
  const pad = 'x'.repeat(2000)
  const long = (k: number) => Array.from({ length: k }, (_, i) => user(`Question ${i} ${pad}`))

  it('reads only the last 256 KB when the reply is there', async () => {
    const { t, reads } = setup([...long(1000), reply('**Done**, all tests pass.')])
    expect((await t.latestReply(pane))?.text).toBe('Done, all tests pass.')
    expect(Math.max(...reads)).toBeLessThanOrEqual(256 * 1024 + 1)
    expect(reads.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(256 * 1024 + 1)
  })

  it('same reply and identity as the whole bottom gives', async () => {
    const { t } = setup([...long(1000), reply('Final answer'), user('Thanks')])
    const short = await t.latestReply(pane)
    const r = await t.chat(pane)
    const last = r.items!.filter(i => i.role === 'assistant').at(-1)!
    expect(last.text).toBe('Final answer')
    expect(short?.text).toBe('Final answer')
    expect(short?.key).toMatch(/:\d+:/)
  })

  it('widens to the bottom of the conversation when the tail holds no reply', async () => {
    // 100 long questions (400 KB) after the reply: within the bottom page.
    const { t, reads } = setup([reply('Older reply'), ...Array.from({ length: 100 }, (_, i) => user(`Question ${i} ${pad}${pad}`))])
    expect((await t.latestReply(pane))?.text).toBe('Older reply')
    expect(Math.max(...reads)).toBeGreaterThan(256 * 1024 + 1)
  })

  it('an unchanged settled transcript is not read again', async () => {
    let clock = Date.now()
    const { t, reads } = setup([...long(1000), reply('Done')], () => clock)
    // Whole-second mtimes count as settled after SETTLE_MS, sub-second ones at once.
    await t.latestReply(pane)
    clock += 60_000
    await t.latestReply(pane)
    const before = reads.length
    expect((await t.latestReply(pane))?.text).toBe('Done')
    expect((await t.latestReply(pane))?.text).toBe('Done')
    expect(reads.length).toBe(before)
  })
})
