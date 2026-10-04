import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'

// The shapes follow omp's session records; all text and identifiers are synthetic.
const line = (d: object) => JSON.stringify(d)
const ts = (second: number) => `2026-01-01T10:00:${String(second).padStart(2, '0')}.000Z`

describe('omp reasoning and injected notices', () => {
  it('keeps thinking between the prompt and tool, with an elapsed estimate', () => {
    const lines = [
      line({ type: 'message', timestamp: ts(1), message: { role: 'user', content: [{ type: 'text', text: 'Check the result' }] } }),
      line({ type: 'message', timestamp: ts(13), message: { role: 'assistant', content: [
        { type: 'thinking', thinking: 'Inspect `result.txt` first.', thinkingSignature: 'signed' },
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'result.txt' } },
      ] } }),
    ]
    const items = parseLines(lines.join('\n'), 'omp')
    expect(items.map(i => i.role)).toEqual(['user', 'thinking', 'tool'])
    expect(items[1]).toMatchObject({ text: 'Inspect `result.txt` first.', ms: 12000 })
  })

  it('turns a completed background job into a compact record with output', () => {
    const items = parseLines(line({ type: 'custom_message', customType: 'async-result', display: true,
      attribution: 'agent', timestamp: ts(15), details: { jobs: [{ jobId: 'bg_1', type: 'bash', durationMs: 77526 }] },
      content: '<system-notice>\nBackground job bg_1 has completed. Resume your work using the result below.\nfirst line\nsecond line\nWall time: 77.53 seconds\n</system-notice>',
    }), 'omp')
    expect(items).toEqual([{ role: 'job', text: '', ts: ts(15), error: false, ms: 77526,
      job: { id: 'bg_1', tool: 'bash', out: 'first line\nsecond line' } }])
  })

  it('never presents synthetic reminders as user messages', () => {
    const items = parseLines([
      line({ type: 'message', timestamp: ts(1), message: { role: 'user', synthetic: true, content: [{ type: 'text', text: 'Reminder' }] } }),
      line({ type: 'custom_message', timestamp: ts(2), customType: 'advisor', display: true, content: '<system-notice>\nCheck context\n</system-notice>' }),
    ].join('\n'), 'omp')
    expect(items.map(i => i.role)).toEqual(['notice'])
  })
})
