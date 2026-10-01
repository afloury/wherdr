// Claude Code "!" commands (bash mode) and outputs of local commands:
// shown as commands with their output, and a "! …" send from wherdr
// leaves the queue as soon as Claude has run it (t-0104).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bashInput, commandOutput, parseLines } from '../server/utils/transcripts'
import { bashText, queuedDone } from '../server/utils/queued'

const items = parseLines(readFileSync(new URL('./fixtures/claude-bash.jsonl', import.meta.url), 'utf8'), 'claude', 0, '/home/user')

describe('bash-input / bash-stdout / bash-stderr entries', () => {
  it('recognizes the tags', () => {
    expect(bashInput('<bash-input> ls -la</bash-input>')).toBe('ls -la')
    expect(bashInput('texte <bash-input>ls</bash-input>')).toBeNull()
    expect(commandOutput('<bash-stdout>a\n</bash-stdout><bash-stderr>b</bash-stderr>')).toEqual({ out: 'a', err: 'b' })
    expect(commandOutput('<local-command-stdout>\u001b[1mGras\u001b[22m</local-command-stdout>')).toEqual({ out: 'Gras', err: '' })
    expect(commandOutput('Bonjour')).toBeNull()
  })

  it('one command per entry, output attached, without raw text or tags', () => {
    const cmds = items.filter(i => i.role === 'bash' || i.role === 'cmd').map(({ role, text, out, err }) => ({ role, text, out, err }))
    expect(cmds).toEqual([
      { role: 'bash', text: 'git status --short', out: ' M src/demo.ts\n?? notes.txt', err: '' },
      { role: 'bash', text: 'ls /introuvable', out: '', err: 'ls: /introuvable: No such file or directory' },
      { role: 'cmd', text: '/context → 12.3k/200k tokens (6%)' },
      { role: 'bash', text: 'echo tableau', out: 'tableau', err: '' },
      { role: 'bash', text: 'true', out: undefined, err: undefined },
    ])
    expect(items.some(i => /<\/?(bash|local-command)-/.test(i.text))).toBe(false)
    // "Kept model as" (cancelled /model menu) stays invisible.
    expect(items.some(i => (i.out || '').includes('Kept model'))).toBe(false)
    expect(items.filter(i => i.role === 'user').map(i => i.text)).toEqual(['Liste les fichiers du projet de démo'])
  })

  it('the executed command leaves Claude\'s queue', () => {
    expect(items.queue).toEqual([])
  })
})

describe('queued "!" send', () => {
  const at = Date.parse('2026-09-28T10:00:03.000Z')
  const q = { id: 'x', at, text: '! git status --short' }

  it('removes the bash mode "!"', () => {
    expect(bashText('! ls')).toBe('ls')
    expect(bashText('!ls -a')).toBe('ls -a')
    expect(bashText('ls')).toBe('ls')
  })

  it('taken as soon as Claude has run the command, agent busy or idle', () => {
    expect(queuedDone(q, items, false, at + 5000)).toBe(true)
    expect(queuedDone({ ...q, text: '!git status --short' }, items, true, at + 5000)).toBe(true)
  })

  it('stays queued as long as the command does not appear', () => {
    const before = items.filter(i => !(i.role === 'bash' && i.text.startsWith('git')))
    expect(queuedDone(q, before, false, at + 5000)).toBe(false)
    // An older identical command does not count.
    expect(queuedDone({ ...q, at: at + 3600e3 - 1 }, items, false, at + 3600e3)).toBe(false)
  })
})
