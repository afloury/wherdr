// "!cmd" typed in Codex runs at once and is written to the rollout as a user
// message wrapped in <user_shell_command>: it shows as a command block, and the
// queued bubble of the same command sent from wherdr goes away (t-0242).
import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'
import { queuedDone } from '../server/utils/queued'
import { pendingQueue } from '../app/utils/pendingQueue'

const T0 = Date.parse('2026-10-07T08:00:00Z')
const iso = (t: number) => new Date(t).toISOString()
const user = (text: string, t: number) => JSON.stringify({ timestamp: iso(t), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
const run = (command: string, exit: number, output: string) =>
  `<user_shell_command>\n<command>\n${command}\n</command>\n<result>\nExit code: ${exit}\nDuration: 5.0123 seconds\nOutput:\n${output}\n</result>\n</user_shell_command>`

describe('Codex "!" command', () => {
  it('becomes a command block with its output and exit code, not a hidden message', () => {
    const items = parseLines([user(run('sleep 5; echo ok', 0, 'ok'), T0 + 6000), user(run('false', 1, ''), T0 + 7000)].join('\n'), 'codex')
    expect(items).toEqual([
      { role: 'bash', text: 'sleep 5; echo ok', out: 'ok', err: '', error: false, ts: iso(T0 + 6000) },
      { role: 'bash', text: 'false', out: '', err: '', error: true, ts: iso(T0 + 7000) },
    ])
  })

  it('takes the queued "!" message off the queue, server and app', () => {
    const items = parseLines(user(run('sleep 5; echo ok', 0, 'ok'), T0 + 6000), 'codex')
    expect(queuedDone({ text: '! sleep 5; echo ok', at: T0 }, items, false, T0 + 7000, 'codex')).toBe(true)
    expect(queuedDone({ text: '! sleep 9; echo ok', at: T0 }, items, false, T0 + 7000, 'codex')).toBe(false)
    expect(pendingQueue({ mine: [{ id: 'a', text: '! sleep 5; echo ok', at: T0 }], claude: [], items, screen: null })).toEqual([])
  })
})
