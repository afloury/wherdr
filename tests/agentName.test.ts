import { describe, expect, it } from 'vitest'
import { AGENT_NAME_RE, toAgentName } from '../shared/ids'

describe('toAgentName', () => {
  it('converts a typed name instead of refusing it', () => {
    expect(toAgentName('Agent portal project')).toBe('agent-portal-project')
  })
  it('keeps a valid name as it is', () => {
    for (const n of ['reviewer', 'a', 'claude-1a2b', 'my_agent-2']) expect(toAgentName(n)).toBe(n)
  })
  it('drops accents and spells ligatures out', () => {
    expect(toAgentName('Revue café œuvre')).toBe('revue-cafe-oeuvre')
    expect(toAgentName('Straße')).toBe('strasse')
  })
  it('turns other characters into one dash and trims the edges', () => {
    expect(toAgentName('  --Hello,   World!!  ')).toBe('hello-world')
    expect(toAgentName('a/b.c@d')).toBe('a-b-c-d')
    expect(toAgentName('_x_')).toBe('x')
  })
  it('adds a letter before a leading digit', () => {
    expect(toAgentName('9 revue')).toBe('a-9-revue')
    expect(toAgentName('2024')).toBe('a-2024')
  })
  it('cuts to 32 without a trailing dash', () => {
    const n = toAgentName('a very long agent name that goes on and on')
    expect(n.length).toBeLessThanOrEqual(32)
    expect(n).toBe('a-very-long-agent-name-that-goes')
    expect(toAgentName(`${'a'.repeat(31)} b`)).toBe('a'.repeat(31))
  })
  it('is empty when nothing usable is left', () => {
    for (const n of ['', '   ', '!!!', '—', '🙂', null, undefined]) expect(toAgentName(n)).toBe('')
  })
  it('always gives a valid agent name or nothing', () => {
    for (const n of ['Agent portal project', '9 revue', 'É', '___1', 'x'.repeat(50), '-_-a', 'ŒIL', '日本語 agent'])
      expect(toAgentName(n)).toMatch(AGENT_NAME_RE)
  })
})
