import { describe, expect, it } from 'vitest'
import { detailsFromTaskFile, parseTaskDetails, parseTaskHandovers, taskAgentIdentity } from '../shared/projectsTasks'

const details = (handovers?: unknown) => parseTaskDetails(JSON.stringify({ task: { id: 'demo/1' }, handovers }))
describe('task handover history', () => {
  it('accepts older CLI replies without history and malformed histories', () => {
    for (const value of [undefined, null, {}, 'history', [null, [], {}, 4]]) expect(details(value).handovers).toEqual([])
  })
  it('orders worker and reviewer handovers by milliseconds without changing current identity', () => {
    const handovers = [
      { at: 2000, role: 'reviewer', from: 'codex/model', to: 'claude/model', why: 'Review rounds exhausted' },
      { at: 1000, role: 'worker', from: 'claude/model', to: 'codex/model', why: 'Out of allowance' },
    ]
    const raw = structuredClone(handovers)
    const before = taskAgentIdentity({ on: 'codex/model', handovers })
    expect(details(handovers).handovers).toEqual([handovers[1], handovers[0]])
    expect(taskAgentIdentity({ on: 'codex/model', handovers })).toEqual(before)
    expect(before).toEqual({ agent: 'codex', reviewer: '', from: 'claude' })
    expect(handovers).toEqual(raw)
    expect(detailsFromTaskFile({ id: 'demo/1', handovers })?.handovers).toEqual(details(handovers).handovers)
  })
  it('keeps partial and unknown fields without inventing dates, roles or participants', () => {
    expect(parseTaskHandovers([{ why: 'Provider unavailable' }, { role: 'future', from: 'pi', at: 'yesterday' }, { to: 'codex', at: -1 }])).toEqual([
      { at: null, role: '', from: '', to: '', why: 'Provider unavailable' },
      { at: null, role: 'future', from: 'pi', to: '', why: '' },
      { at: null, role: '', from: '', to: 'codex', why: '' },
    ])
    expect(parseTaskHandovers([{ at: Infinity }, { at: 8640000000000001 }])).toEqual([])
  })
})
