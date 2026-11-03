// A wheel report cut in two by a full tty buffer reached Codex as Escape
// (turn interrupted) plus "[<65;76;23M" typed into its field (t-0356):
// the interruption shows in the conversation and
// the text left in Codex's field is read from its screen.
import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'

describe('Codex interrupted turn', () => {
  const at = '2026-10-15T08:00:00.000Z'
  const user = JSON.stringify({ timestamp: at, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run the tests' }] } })
  const aborted = (reason: string) => JSON.stringify({ timestamp: '2026-10-15T08:00:07.000Z', type: 'event_msg', payload: { type: 'turn_aborted', turn_id: 't1', reason } })
  const dev = JSON.stringify({ timestamp: '2026-10-15T08:00:07.000Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<turn_aborted>\nThe previous turn was interrupted.\n</turn_aborted>' }] } })

  it('shows "Interrupted" after the message, like Claude', () => {
    expect(parseLines([user, dev, aborted('interrupted')].join('\n'), 'codex')).toEqual([
      { role: 'user', text: 'Run the tests', images: 0, ref: undefined, ts: at },
      { role: 'system', text: 'Interrupted', ts: '2026-10-15T08:00:07.000Z' },
    ])
  })

  it('ignores other end reasons', () => {
    expect(parseLines([user, aborted('replaced')].join('\n'), 'codex').map(i => i.role)).toEqual(['user'])
  })
})

