import { describe, expect, it } from 'vitest'
import { taskAgentIdentity } from '../shared/projectsTasks'

describe('task agent identity', () => {
  it('keeps the worker while a different program reviews', () => {
    expect(taskAgentIdentity({ stage: 'reviewing', agent: 'claude', app: 'codex', link: { reviewer: { kind: 'codex' } } })).toEqual({ agent: 'claude', reviewer: 'codex', from: '' })
  })
  it('uses a recorded takeover, ignoring reviewer handovers and stale worker history', () => {
    const handovers = [{ role: 'worker', from: 'claude/opus', to: 'codex/gpt' }, { role: 'reviewer', from: 'codex', to: 'claude' }]
    expect(taskAgentIdentity({ on: 'codex/gpt', agent: 'claude', handovers })).toEqual({ agent: 'codex', reviewer: '', from: 'claude' })
    expect(taskAgentIdentity({ agent: 'claude', handovers }).from).toBe('')
  })
  it('does not present a saved verdict or a stale link as an active review', () => {
    expect(taskAgentIdentity({ stage: 'approval', agent: 'claude', link: { reviewer: { kind: 'codex' } }, review: { by: 'codex' } })).toEqual({ agent: 'claude', reviewer: '', from: '' })
    expect(taskAgentIdentity(null)).toEqual({ agent: '', reviewer: '', from: '' })
  })
})
