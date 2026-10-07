// "!" / "$" commands the user runs in omp's input field: read from omp's
// transcript once over, from its screen while running, and matched against
// the message wherdr sent so that it leaves the "queued" list.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'
import { parseOmpShell } from '../server/utils/ompScreen'
import { queuedDone } from '../server/utils/queued'
import { queuedPhases } from '../shared/queuedPhase'
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

describe('parseOmpShell', () => {
  it('reads the running command and the output rows omp keeps on screen', () => {
    const s = parseOmpShell(fx('omp-shell-running.txt'), 1000)!
    expect(s.command).toBe('for i in $(seq 1 40); do echo row$i; sleep 0.1; done; sleep 6')
    expect(s.lines).toEqual(Array.from({ length: 12 }, (_, i) => `row${29 + i}`))
    expect(s.hidden).toBe(7)
    expect(s.since).toBe(1000)
    expect(s.python).toBeUndefined()
  })
  it('reads a running "$" Python cell', () => {
    expect(parseOmpShell(fx('omp-python-running.txt'), 0)).toEqual({ command: 'import time; print("py"); time.sleep(6)', lines: ['py'], hidden: 0, since: 0, python: true })
  })
  it('nothing once the run is over (no "Running…" line)', () => {
    expect(parseOmpShell(fx('omp-shell-running.txt').replace(/^.*Running….*$/m, ''))).toBeNull()
  })
  // Real screens of omp 18.6 with `symbolPreset: nerd` (Esc drawn as U+F12B7)
  // and `ascii` ("Esc", "-\|/" spinner, dashed rules).
  it('reads the run with the nerd-font and ascii symbol presets', () => {
    expect(parseOmpShell(fx('omp-shell-nerd.txt'), 0)).toEqual({ command: 'for i in 1 2 3; do echo $i; done; sleep 30', lines: ['1'], hidden: 0, since: 0 })
    expect(parseOmpShell(fx('omp-shell-ascii.txt'), 0)).toEqual({ command: 'for i in 1 2 3; do echo $i; done; sleep 30', lines: ['1', '2', '3'], hidden: 0, since: 0 })
  })
  it('not another "to cancel" hint (a key omp does not draw)', () => {
    expect(parseOmpShell(fx('omp-shell-nerd.txt').replace('(\u{F12B7} to cancel)', '(Ctrl+C to cancel)'))).toBeNull()
  })
})

describe('the message sent from wherdr', () => {
  const at = Date.parse('2026-10-04T16:03:30Z')
  it('is running while omp shows it, for "!" and "$" alike', () => {
    const shell = parseOmpShell(fx('omp-shell-running.txt'))!
    const screen = { shell, sent: null, queued: [] }
    expect(queuedPhases(['!for i in $(seq 1 40); do echo row$i; sleep 0.1; done; sleep 6', '!other'], screen)).toEqual(['running', 'queued'])
    const py = { shell: parseOmpShell(fx('omp-python-running.txt'))!, sent: null, queued: [] }
    expect(queuedPhases(['$ import time; print("py"); time.sleep(6)'], py)).toEqual(['running'])
    // A Python cell does not match a "!" message with the same text, nor the reverse.
    expect(queuedPhases(['!import time; print("py"); time.sleep(6)'], py)).toEqual(['queued'])
  })
  it('leaves the queue once omp wrote the run, "!!" and "$" prefixes included', () => {
    for (const text of ['! echo hello', '!!ls /nonexistent-dir', '$ print(40+2)', '$$print(40+2)']) {
      expect(queuedDone({ text, at }, items, true, at + 60000)).toBe(true)
    }
    expect(queuedDone({ text: '!echo goodbye', at }, items, true, at + 60000)).toBe(false)
  })
  it('is not listed twice once the run is in the conversation', () => {
    const mine = [{ id: 'a', text: '!!ls /nonexistent-dir', at }, { id: 'b', text: '!echo goodbye', at }]
    expect(pendingQueue({ mine, claude: [], items, screen: null }).map(q => q.id)).toEqual(['b'])
  })
  // omp runs a "!" / "$" typed during a turn at once, but writes it to the
  // transcript only when the next prompt starts (seen with a multi-line "!"
  // command left "Queued · sending…" after it ran).
  it('leaves the queue when the turn it was typed in is over, before omp writes the run', () => {
    const text = '! herdr-projects profile add work --agent omp \\\n  --arg --config --arg ~/.omp/agent/work.yml \\\n  --description "Work threads: (no push)"'
    const before = items.filter(i => i.role !== 'bash')
    expect(queuedDone({ text, at, turnSeen: true }, before, false, at + 5000, 'omp')).toBe(false)
    expect(queuedDone({ text, at, turnSeen: true }, before, true, at + 5000, 'omp')).toBe(true)
    expect(queuedDone({ text: '$ print(1)\nprint(2)', at, turnSeen: true }, before, true, at + 5000, 'omp')).toBe(true)
    // Typed while omp was ready: the run is written as soon as it ends.
    expect(queuedDone({ text, at }, before, true, at + 5000, 'omp')).toBe(false)
    // A message, not a run: still waits for the transcript.
    for (const t of ['note: line one \\\nline two', '$HOME is set']) {
      expect(queuedDone({ text: t, at, turnSeen: true }, [], true, at + 5000, 'omp')).toBe(false)
    }
    // Claude writes its "!" commands at once: no shortcut.
    expect(queuedDone({ text, at, turnSeen: true }, before, true, at + 5000, 'claude')).toBe(false)
  })
})
