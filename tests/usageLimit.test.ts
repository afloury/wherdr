import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseUsageLimit } from '../shared/usageLimit'
import { parseChoices } from '../server/utils/choices'
import { classifyScreen } from '../shared/interactiveScreen'
const fixture = (name: string) => readFileSync(new URL(`./fixtures/claude-limit-${name}.txt`, import.meta.url), 'utf8')

describe('Claude live quota wait', () => {
  for (const name of ['weekly', 'session']) it(`recognizes the ${name} banner without terminal fallback`, () => {
    const text = fixture(name)
    expect(parseUsageLimit(text, 'claude')).toEqual({ resets: name === 'weekly' ? '11pm' : '3pm', automatic: true, credits: true, resetLink: name === 'weekly' })
    expect(classifyScreen({ text, agent: 'claude', status: 'blocked', choices: parseChoices(text, { strict: false }) })).toBe('native')
  })
  it('does not retain an old error after the live banner disappears', () => {
    const text = fixture('weekly').replace(/  ⚠ Usage limit reached[^]*$/, '  ? for shortcuts')
    expect(parseUsageLimit(text, 'claude')).toBeNull()
    expect(classifyScreen({ text, agent: 'claude' })).toBe('input')
  })
  it('does not invent automatic continuation or actions after cancellation', () => {
    const text = fixture('session').replace(/    Continuing automatically[^\n]+\n/, '')
    expect(parseUsageLimit(text, 'claude')).toEqual({ resets: '3pm', automatic: false, credits: false, resetLink: false })
  })
  it('does not reinterpret another agent or an approval as a quota wait', () => {
    expect(classifyScreen({ text: fixture('weekly'), agent: 'claude', status: 'unknown' })).toBe('unknown')
    expect(parseUsageLimit(fixture('weekly'), 'codex')).toBeNull()
    expect(parseUsageLimit(fixture('weekly'), 'omp')).toBeNull()
    expect(parseUsageLimit('⚠ Usage limit reached · limit resets 11pm', 'claude')).toBeNull()
  })
  it('does not steal a newer approval below a quoted quota screen', () => {
    const approval = readFileSync(new URL('./fixtures/claude-approve-bash.txt', import.meta.url), 'utf8')
    expect(parseUsageLimit(`${fixture('weekly')}\n${approval}`, 'claude')).toBeNull()
  })
})
