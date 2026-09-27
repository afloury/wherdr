// Ligne d'activité de Claude Code (« ✢ Boondoggling… (1m 53s · ↓ 6.9k tokens) »).
// Lignes relevées sur un vrai Claude Code 2.1.x (herdr pane read), écrans
// complets reconstitués autour (claude-working*, claude-done).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseClaudeActivity, parseClaudeActivityLine } from '../server/utils/activity'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseClaudeActivityLine', () => {
  it('lit les lignes réelles, quel que soit le glyphe animé', () => {
    const real = [
      '✢ Boondoggling… (1m 14s · ↓ 4.6k tokens)',
      '✶ Boondoggling… (1m 15s · ↓ 4.6k tokens)',
      '✳ Boondoggling… (1m 16s · ↓ 4.6k tokens)',
      '✻ Boondoggling… (1m 26s · ↓ 4.8k tokens · thinking)',
      '· Boondoggling… (1m 35s · ↓ 4.8k tokens · still thinking)',
      '✽ Boondoggling… (1m 38s · ↓ 5.9k tokens · thought for 12s)',
    ]
    for (const l of real) {
      const a = parseClaudeActivityLine(l)
      expect(a, l).not.toBeNull()
      expect(a!.verb).toBe('Boondoggling')
      expect(a!.glyph).toBe(l[0])
    }
    expect(parseClaudeActivityLine(real[3]!)).toEqual({ glyph: '✻', verb: 'Boondoggling', elapsed: '1m 26s', tokens: '4.8k' })
  })

  it('accepte les variantes : glyphe Linux, points ASCII, sans parenthèses, ancienne forme', () => {
    expect(parseClaudeActivityLine('* Orbiting… (3s)')).toEqual({ glyph: '*', verb: 'Orbiting', elapsed: '3s', tokens: null })
    expect(parseClaudeActivityLine('✻ Moseying...')).toMatchObject({ verb: 'Moseying', elapsed: null, tokens: null })
    expect(parseClaudeActivityLine('✶ Levitating… (esc to interrupt)')).toMatchObject({ verb: 'Levitating', elapsed: null })
    expect(parseClaudeActivityLine('✳ Levitating… (1h 2m 3s · ↑ 12.5k tokens · esc to interrupt)')).toMatchObject({ elapsed: '1h 2m 3s', tokens: '12.5k' })
    expect(parseClaudeActivityLine('✻ Kneading the dough… (5s)')!.verb).toBe('Kneading the dough')
  })

  it('ignore les lignes sans verbe en cours', () => {
    for (const l of [
      '✻ Worked for 2m 31s',
      '✻ Cogitated for 45s',
      '  Running 1 shell command · 2s…',
      '⏺ Running npx vitest run…',
      '  ⎿  Tip: Use /btw to ask a quick side question',
      '❯ Ex. « ✻ Orbiting… » avec l\'effet',
      '  ✻ Orbiting… (4s)',
      '· Première puce d’une liste',
      '',
    ]) expect(parseClaudeActivityLine(l), l).toBeNull()
  })
})

describe('parseClaudeActivity', () => {
  it('trouve la ligne au-dessus du champ de saisie, astuce entre les deux', () => {
    expect(parseClaudeActivity(fx('claude-working.txt'))).toEqual({ glyph: '✢', verb: 'Boondoggling', elapsed: '1m 53s', tokens: '6.9k' })
  })

  it('passe la liste de tâches et ignore un verbe tapé dans le champ de saisie', () => {
    expect(parseClaudeActivity(fx('claude-working-todos.txt'))).toMatchObject({ verb: 'Orbiting', tokens: '1.2k' })
  })

  it('ne trouve rien au repos, sans écran ou sur une question', () => {
    expect(parseClaudeActivity(fx('claude-done.txt'))).toBeNull()
    expect(parseClaudeActivity(fx('claude-idle.txt'))).toBeNull()
    expect(parseClaudeActivity(fx('claude-ask.txt'))).toBeNull()
    expect(parseClaudeActivity('')).toBeNull()
    expect(parseClaudeActivity(null)).toBeNull()
  })

  it('ne remonte pas au-delà de 20 lignes au-dessus du cadre', () => {
    const rule = '─'.repeat(40)
    const screen = ['✻ Orbiting… (4s)', ...Array(25).fill('  ligne'), rule, '❯ ', rule].join('\n')
    expect(parseClaudeActivity(screen)).toBeNull()
  })
})
