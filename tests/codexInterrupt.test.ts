// A wheel report cut in two by a full tty buffer reached Codex as Escape
// (turn interrupted) plus "[<65;76;23M" typed into its field (t-0356):
// scrolls are rate-limited, the interruption shows in the conversation and
// the text left in Codex's field is read from its screen.
import { describe, expect, it } from 'vitest'
import { createScrollThrottle } from '../server/utils/scrollThrottle'
import { parseLines } from '../server/utils/transcripts'
import { codexFieldLine } from '../server/utils/unqueue'

function clock() {
  let t = 1000
  const timers: { at: number, fn: () => void }[] = []
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { const x = { at: t + ms, fn }; timers.push(x); return x },
    clearTimer: (x: never) => { timers.splice(timers.indexOf(x), 1) },
    advance(ms: number) {
      t += ms
      for (const x of [...timers].sort((a, b) => a.at - b.at)) {
        if (x.at > t) continue
        timers.splice(timers.indexOf(x), 1)
        x.fn()
      }
    },
    pending: () => timers.length,
  }
}

describe('scroll throttle', () => {
  it('sends the first scroll at once, then merges the following ones', () => {
    const c = clock()
    const sent: [string, number][] = []
    const s = createScrollThrottle((d, n) => sent.push([d, n]), { intervalMs: 75, ...c })
    s.push('down', 1)
    expect(sent).toEqual([['down', 1]])
    for (let i = 0; i < 4; i++) { c.advance(16); s.push('down', 2) }
    expect(sent).toHaveLength(1)
    c.advance(75)
    expect(sent).toEqual([['down', 1], ['down', 8]])
  })

  it('sends at most one scroll per interval during a long flick', () => {
    const c = clock()
    let count = 0
    const s = createScrollThrottle(() => { count++ }, { intervalMs: 75, ...c })
    // Two seconds of trackpad momentum, one scroll per animation frame.
    for (let i = 0; i < 120; i++) { s.push('up', 1); c.advance(16) }
    c.advance(100)
    expect(count).toBeLessThanOrEqual(Math.ceil(120 * 16 / 75) + 1)
    expect(count).toBeGreaterThan(20)
  })

  it('nets opposite directions and drops a zero sum', () => {
    const c = clock()
    const sent: [string, number][] = []
    const s = createScrollThrottle((d, n) => sent.push([d, n]), { intervalMs: 75, ...c })
    s.push('up', 3)
    s.push('down', 5)
    s.push('up', 1)
    c.advance(80)
    s.push('up', 2)
    s.push('down', 2)
    c.advance(80)
    expect(sent).toEqual([['up', 3], ['down', 4]])
  })

  it('caps the lines and forgets pending scrolls on dispose', () => {
    const c = clock()
    const sent: [string, number][] = []
    const s = createScrollThrottle((d, n) => sent.push([d, n]), { intervalMs: 75, ...c })
    s.push('up', 400)
    s.push('up', 400)
    s.push('up', 400)
    c.advance(80)
    expect(sent).toEqual([['up', 400], ['up', 500]])
    s.push('down', 3)
    s.push('down', 3)
    s.dispose()
    expect(c.pending()).toBe(0)
    c.advance(200)
    expect(sent).toHaveLength(2)
  })
})

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

describe('Codex field', () => {
  const footer = '  \x1b[0m\x1b[38;2;246;226;183mgpt-model medium\x1b[0m · \x1b[0m\x1b[38;2;171;223;167m~/project\x1b[0m\r'
  const screen = (field: string) => ['\x1b[0m\x1b[1m› \x1b[0mearlier message\r', '\x1b[0m• Done.\r', '', field, footer].join('\n')

  it('reads the placeholder as empty', () => {
    expect(codexFieldLine(screen('\x1b[0m\x1b[1m› \x1b[0m\x1b[2mAsk Codex to do anything\x1b[0m\r'))).toBe('')
  })

  it('reads text left in the field', () => {
    expect(codexFieldLine(screen('\x1b[0m\x1b[1m› \x1b[0m[<65;76;23M\r'))).toBe('[<65;76;23M')
  })

  it('returns null without a field', () => {
    expect(codexFieldLine('$ ls\r\nfile.txt\r\n')).toBeNull()
  })
})
