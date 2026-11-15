// Commands run with Run: a live card from the click until the transcript
// writes the command, then that entry alone (composables/useCodeRun.ts).
import { describe, expect, it } from 'vitest'
import { RUN_MAX_MS, newRun, runMarks, settleRuns } from '../app/composables/useCodeRun'

const at = Date.parse('2026-01-01T10:00:00Z')
const entry = (text: string, ts: string, ms?: number) => ({ role: 'bash' as const, text, ts, out: 'ok', ...(ms === undefined ? {} : { ms }) })

describe('runs of a command', () => {
  it('stays running until its own entry has its output, then finishes at its end', () => {
    const old = [entry('make deploy', '2026-01-01T09:00:00Z')]
    const run = newRun([], old, 'make deploy', at)
    expect(run.seen).toBe(1)
    // The older entry, or this one without its output yet: still running.
    expect(settleRuns([run], [...old, { role: 'bash', text: 'make deploy', ts: '2026-01-01T10:00:01Z' }], at + 5000)[0]!.doneAt).toBeUndefined()
    const done = settleRuns([run], [...old, entry('make  deploy', '2026-01-01T10:00:01Z', 60_000)], at + 90_000)[0]!
    expect(done.doneAt).toBe(at + 61_000)
    expect(runMarks([done])).toEqual({ makedeploy: { running: false, at: at + 61_000 } })
  })

  it('a second click while the first runs waits for the next entry', () => {
    const first = newRun([], [], 'npm test', at)
    const second = newRun([first], [], 'npm test', at + 1000)
    expect(second.seen).toBe(1)
    const runs = settleRuns([first, second], [entry('npm test', '2026-01-01T10:00:30Z')], at + 31_000)
    expect(runs.map(r => r.doneAt !== undefined)).toEqual([true, false])
    expect(runMarks(runs).npmtest!.running).toBe(true)
  })

  it('stops showing as running once past the limit', () => {
    const run = newRun([], [], 'sleep 1', at)
    expect(settleRuns([run], [], at + RUN_MAX_MS + 1)[0]!.doneAt).toBe(at + RUN_MAX_MS + 1)
  })
})
