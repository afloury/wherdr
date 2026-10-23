import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { createTranscripts } from '../server/utils/transcripts'
import { bindFunction } from './stateFunction'

const source = readFileSync('server/utils/state.ts', 'utf8')

it.each(['claude', 'codex', 'omp'])('%s reply identity survives a moving tail without a false new-message push', async agent => {
  const home = mkdtempSync(path.join(tmpdir(), 'reply-identity-'))
  try {
    const session = '00000000-0000-4000-8000-000000000001'
    const file = agent === 'claude' ? path.join(home, '.claude/projects/-example', `${session}.jsonl`)
      : agent === 'codex' ? path.join(home, '.codex/sessions/2026/01/01', `rollout-2026-01-01T00-00-00-${session}.jsonl`)
        : path.join(home, '.omp/agent/sessions/-example', `${session}.jsonl`)
    mkdirSync(path.dirname(file), { recursive: true })
    const timestamp = '2026-01-01T00:01:00Z'
    const line = (text: string) => JSON.stringify(agent === 'claude'
      ? { type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'text', text }] } }
      : agent === 'codex'
        ? { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } }
        : { type: 'message', timestamp, message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n'
    writeFileSync(file, line('x'.repeat(10000)).repeat(430) + line('Latest answer'))
    const pane = { id: 'w1:p1', agent, cwd: '/example', agentSession: agent === 'omp' ? file : session, status: 'working' }
    const transcripts = createTranscripts({ home, herdr: async () => { throw new Error('No Herdr in this test') } })
    const before = await transcripts.chat(pane, {})
    const first = await transcripts.latestReply(pane)
    expect(first?.text).toBe('Latest answer')

    const previews = new Map()
    const previewBusy = new Set()
    const notifyPane = vi.fn(async () => {})
    const refresh = bindFunction(source, 'refreshPreview', {
      previews, previewBusy, trFor: () => transcripts, findPane: () => pane, notifyPane, log: () => {},
    })
    const poll = async () => {
      refresh(pane)
      await vi.waitFor(() => expect(previewBusy.size).toBe(0))
    }
    await poll()
    // This ignored line shifts the 2 MiB reading window, not the answer.
    appendFileSync(file, JSON.stringify({ type: 'progress', data: 'x'.repeat(30000) }) + '\n')
    const after = await transcripts.chat(pane, {})
    expect(after.start).toBeGreaterThan(before.start!)
    expect(after.items!.length).toBeLessThan(before.items!.length)
    expect(await transcripts.latestReply(pane)).toEqual(first)
    await poll()
    expect(notifyPane).not.toHaveBeenCalled()

    // A genuinely new reply must still notify, even with identical text/time.
    appendFileSync(file, line('Latest answer'))
    expect((await transcripts.latestReply(pane))?.key).not.toBe(first?.key)
    await poll()
    expect(notifyPane).toHaveBeenCalledExactlyOnceWith(pane, 'message')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
