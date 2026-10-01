// Claude Code activity line ("✢ Boondoggling… (1m 53s · ↓ 6.9k tokens)").
// Lines captured on a real Claude Code 2.1.x (herdr pane read), full
// screens rebuilt around them (claude-working*, claude-done).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseClaudeActivity, parseClaudeActivityLine } from '../server/utils/activity'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('parseClaudeActivityLine', () => {
  it('reads the real lines, whatever the animated glyph', () => {
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

  it('accepts the variants: Linux glyph, ASCII dots, no parentheses, old form', () => {
    expect(parseClaudeActivityLine('* Orbiting… (3s)')).toEqual({ glyph: '*', verb: 'Orbiting', elapsed: '3s', tokens: null })
    expect(parseClaudeActivityLine('✻ Moseying...')).toMatchObject({ verb: 'Moseying', elapsed: null, tokens: null })
    expect(parseClaudeActivityLine('✶ Levitating… (esc to interrupt)')).toMatchObject({ verb: 'Levitating', elapsed: null })
    expect(parseClaudeActivityLine('✳ Levitating… (1h 2m 3s · ↑ 12.5k tokens · esc to interrupt)')).toMatchObject({ elapsed: '1h 2m 3s', tokens: '12.5k' })
    expect(parseClaudeActivityLine('✻ Kneading the dough… (5s)')!.verb).toBe('Kneading the dough')
  })

  it('ignores lines without a verb in progress', () => {
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
  it('finds the line above the input field, with a tip in between', () => {
    expect(parseClaudeActivity(fx('claude-working.txt'))).toEqual({ glyph: '✢', verb: 'Boondoggling', elapsed: '1m 53s', tokens: '6.9k' })
  })

  it('skips the task list and ignores a verb typed in the input field', () => {
    expect(parseClaudeActivity(fx('claude-working-todos.txt'))).toMatchObject({ verb: 'Orbiting', tokens: '1.2k' })
  })

  it('finds nothing when idle, without a screen or on a question', () => {
    expect(parseClaudeActivity(fx('claude-done.txt'))).toBeNull()
    expect(parseClaudeActivity(fx('claude-idle.txt'))).toBeNull()
    expect(parseClaudeActivity(fx('claude-ask.txt'))).toBeNull()
    expect(parseClaudeActivity('')).toBeNull()
    expect(parseClaudeActivity(null)).toBeNull()
  })

  it('does not go further than 20 lines above the frame', () => {
    const rule = '─'.repeat(40)
    const screen = ['✻ Orbiting… (4s)', ...Array(25).fill('  ligne'), rule, '❯ ', rule].join('\n')
    expect(parseClaudeActivity(screen)).toBeNull()
  })
})
