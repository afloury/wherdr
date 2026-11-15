// "!" / "$" commands the user runs in omp's input field: read from omp's
// transcript once over, and matched against the message wherdr sent so that
// it leaves the "queued" list.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'
import { pendingQueue } from '../app/utils/pendingQueue'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const items = parseLines(fx('omp-user-shell.jsonl'), 'omp', 0, '/home/user')

describe('omp user commands in the transcript', () => {
  it('become user-side runs drawn like omp: command, exit code, output tail', () => {
    expect(items.map(i => [i.role, i.text, i.omp?.title, i.omp?.exit ?? 0, Boolean(i.error)])).toEqual([
      ['bash', 'echo hello', 'Bash', 0, false],
      ['bash', 'false', 'Bash', 1, true],
      ['bash', 'sleep 8; echo done', 'Bash', 0, false],
      ['bash', 'print(40+2)', 'Python', 0, false],
      ['bash', 'for i in 1 2 3 4 5 6; do echo line$i; sleep 1; done', 'Bash', 0, false],
      ['bash', 'ls /nonexistent-dir', 'Bash', 2, true],
      ['bash', 'sleep 30', 'Bash', 0, true],
      ['bash', 'for i in $(seq 1 40); do echo row$i; sleep 0.1; done; sleep 6', 'Bash', 0, false],
      ['bash', 'import time; print("py"); time.sleep(6)', 'Python', 0, false],
    ])
    expect(items[0]!.omp).toMatchObject({ out: 'hello', outLines: 1 })
    expect(items[1]!.omp!.out).toBeUndefined()
    expect(items[3]!.omp!.out).toBe('42')
  })
  it('a cancelled run is flagged, without omp\'s "[Command cancelled]" note as output', () => {
    expect(items[6]!.omp).toEqual({ title: 'Bash', target: 'sleep 30', cancelled: true })
  })
})

describe('the message sent from wherdr', () => {
  const at = Date.parse('2026-10-04T16:03:30Z')
  it('is not listed twice once the run is in the conversation', () => {
    const mine = [{ id: 'a', text: '!!ls /nonexistent-dir', at }, { id: 'b', text: '!echo goodbye', at }]
    expect(pendingQueue({ mine, claude: [], items, screen: null }).map(q => q.id)).toEqual(['b'])
  })
})
