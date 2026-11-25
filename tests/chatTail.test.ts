// The /api/chat read deadline: pure helper, no store or fetch.
import { describe, expect, it } from 'vitest'
import { CHAT_COLD_READ_MS, CHAT_READ_MS, chatReadTimeoutMs } from '../app/utils/chatTail'

describe('chatTail read deadline', () => {
  it('gives a cold snapshot-backed read 30 s and keeps 8 s for polls and JSONL agents', () => {
    for (const agent of ['agy', 'hermes']) {
      expect(chatReadTimeoutMs(agent, true)).toBe(CHAT_COLD_READ_MS)
      expect(chatReadTimeoutMs(agent, true)).toBe(30_000)
      expect(chatReadTimeoutMs(agent, false)).toBe(CHAT_READ_MS)
    }
    // A JSONL conversation opens in one bounded read: no cold allowance.
    for (const agent of ['claude', 'codex', 'omp', 'devin', null, undefined]) {
      expect(chatReadTimeoutMs(agent, true)).toBe(CHAT_READ_MS)
      expect(chatReadTimeoutMs(agent, false)).toBe(CHAT_READ_MS)
    }
    expect(chatReadTimeoutMs('agy', false)).toBe(8000)
  })
})
