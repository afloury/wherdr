// Commandes « ! » de Claude Code (mode bash) et sorties des commandes locales :
// affichées comme commandes avec leur sortie, et un envoi « ! … » de wherdr
// sort de la file dès que Claude l'a exécuté (t-0104).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bashInput, commandOutput, parseLines } from '../server/utils/transcripts'
import { bashText, queuedDone } from '../server/utils/queued'

const items = parseLines(readFileSync(new URL('./fixtures/claude-bash.jsonl', import.meta.url), 'utf8'), 'claude', 0, '/home/user')

describe('entrées bash-input / bash-stdout / bash-stderr', () => {
  it('reconnaît les balises', () => {
    expect(bashInput('<bash-input> ls -la</bash-input>')).toBe('ls -la')
    expect(bashInput('texte <bash-input>ls</bash-input>')).toBeNull()
    expect(commandOutput('<bash-stdout>a\n</bash-stdout><bash-stderr>b</bash-stderr>')).toEqual({ out: 'a', err: 'b' })
    expect(commandOutput('<local-command-stdout>\u001b[1mGras\u001b[22m</local-command-stdout>')).toEqual({ out: 'Gras', err: '' })
    expect(commandOutput('Bonjour')).toBeNull()
  })

  it('une commande par entrée, sortie rattachée, sans texte brut ni balises', () => {
    const cmds = items.filter(i => i.role === 'bash' || i.role === 'cmd').map(({ role, text, out, err }) => ({ role, text, out, err }))
    expect(cmds).toEqual([
      { role: 'bash', text: 'git status --short', out: ' M src/demo.ts\n?? notes.txt', err: '' },
      { role: 'bash', text: 'ls /introuvable', out: '', err: 'ls: /introuvable: No such file or directory' },
      { role: 'cmd', text: '/context → 12.3k/200k tokens (6%)' },
      { role: 'bash', text: 'echo tableau', out: 'tableau', err: '' },
      { role: 'bash', text: 'true', out: undefined, err: undefined },
    ])
    expect(items.some(i => /<\/?(bash|local-command)-/.test(i.text))).toBe(false)
    // « Kept model as » (menu /model annulé) reste invisible.
    expect(items.some(i => (i.out || '').includes('Kept model'))).toBe(false)
    expect(items.filter(i => i.role === 'user').map(i => i.text)).toEqual(['Liste les fichiers du projet de démo'])
  })

  it('la commande exécutée sort de la file de Claude', () => {
    expect(items.queue).toEqual([])
  })
})

describe('envoi « ! » en attente', () => {
  const at = Date.parse('2026-09-28T10:00:03.000Z')
  const q = { id: 'x', at, text: '! git status --short' }

  it('retire le « ! » du mode bash', () => {
    expect(bashText('! ls')).toBe('ls')
    expect(bashText('!ls -a')).toBe('ls -a')
    expect(bashText('ls')).toBe('ls')
  })

  it('pris dès que Claude a exécuté la commande, agent occupé ou au repos', () => {
    expect(queuedDone(q, items, false, at + 5000)).toBe(true)
    expect(queuedDone({ ...q, text: '!git status --short' }, items, true, at + 5000)).toBe(true)
  })

  it('reste en attente tant que la commande n’apparaît pas', () => {
    const before = items.filter(i => !(i.role === 'bash' && i.text.startsWith('git')))
    expect(queuedDone(q, before, false, at + 5000)).toBe(false)
    // Une commande identique plus ancienne ne compte pas.
    expect(queuedDone({ ...q, at: at + 3600e3 - 1 }, items, false, at + 3600e3)).toBe(false)
  })
})
