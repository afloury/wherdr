import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parseUsageLimit } from '../shared/usageLimit'
import { parseChoices } from '../server/utils/choices'
import { classifyScreen } from '../shared/interactiveScreen'
import { bindFunction } from './stateFunction'
import { isSlashCommand } from '../shared/queuedMatch'
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

// Exercise the production sender: Herdr's raw state can still be blocked while
// the enriched pane exposes the usable quota input.
it('sends quota commands through the checked field, preserving other slash routing', async () => {
  const source = readFileSync(new URL('../server/utils/state.ts', import.meta.url), 'utf8')
  const guardedSend = vi.fn(async () => ({ unsent: [] }))
  const agentPrompt = vi.fn(async () => {})
  let p = { id: 'w1:p1', agent: 'claude', status: 'idle', usageLimit: parseUsageLimit(fixture('weekly'), 'claude') }
  const send = bindFunction(source.replace('export function sendPrompt', 'function sendPrompt'), 'sendPrompt', {
    withPaneLock: (_id: string, fn: () => unknown) => fn(), findPane: () => p,
    GUARD_STATES: new Set(['idle', 'done', 'working']), isSlashCommand,
    guardedSend, agentPrompt, sleep: async () => {},
  })
  await send(p, '/usage-credits')
  expect(guardedSend).toHaveBeenCalledOnce()
  expect(agentPrompt).not.toHaveBeenCalled()
  p = { ...p, usageLimit: null }
  await send(p, '/usage')
  expect(agentPrompt).toHaveBeenCalledExactlyOnceWith('w1:p1', '/usage')
})
