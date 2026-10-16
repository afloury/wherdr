import { describe, expect, it } from 'vitest'
import { createActivity, integrationCommand, missingIntegration, parseIntegrationStatus } from '../shared/integrations'

// Output of `herdr integration status` (Herdr 0.9), with a placeholder home.
const STATUS = `pi: not installed (/home/u/.pi/agent/extensions/herdr-agent-state.ts)
omp: current (v10) (/home/u/.omp/agent/extensions/herdr-omp-agent-state.ts)
claude: current (v10) (/home/u/.claude/hooks/herdr-agent-state.sh)
codex: not installed (/home/u/.codex/herdr-agent-state.sh)
copilot: outdated (v3) (/home/u/.copilot/hooks/herdr-agent-state.sh)
herdr integration commands:
  herdr integration install pi
  herdr integration install codex
`

describe('parseIntegrationStatus', () => {
  it('reads each agent state and ignores the command list', () => {
    expect(parseIntegrationStatus(STATUS)).toEqual({ pi: 'missing', omp: 'installed', claude: 'installed', codex: 'missing', copilot: 'outdated' })
  })
  it('returns nothing for unrelated output', () => {
    expect(parseIntegrationStatus('')).toEqual({})
    expect(parseIntegrationStatus('error: unrecognized subcommand')).toEqual({})
  })
})

describe('missingIntegration', () => {
  const status = parseIntegrationStatus(STATUS)
  const codex = { agent: 'codex', agentSession: null, bornAt: 1000 }

  it('blames the missing integration of an agent seen at work', () => {
    expect(missingIntegration(codex, status, true)).toBe(true)
  })
  it('blames it for an agent already running when wherdr started', () => {
    expect(missingIntegration({ ...codex, bornAt: undefined }, status, false)).toBe(true)
  })
  it('keeps "No conversation yet" for a fresh agent never asked anything', () => {
    expect(missingIntegration(codex, status, false)).toBe(false)
  })
  it('never blames an installed or outdated integration', () => {
    expect(missingIntegration({ ...codex, agent: 'claude' }, status, true)).toBe(false)
    expect(missingIntegration({ ...codex, agent: 'copilot' }, status, true)).toBe(false)
  })
  it('never blames it when a session is reported, or when the status is unknown', () => {
    expect(missingIntegration({ ...codex, agentSession: 'abc' }, status, true)).toBe(false)
    expect(missingIntegration(codex, null, true)).toBe(false)
    expect(missingIntegration(codex, {}, true)).toBe(false)
    expect(missingIntegration({ ...codex, agent: null }, status, true)).toBe(false)
  })
})

describe('createActivity', () => {
  it('remembers an agent seen working, until another agent takes the pane', () => {
    const a = createActivity()
    a.observe({ id: 'w1:p1', agent: 'codex', status: 'idle' })
    expect(a.was('w1:p1', 'codex')).toBe(false)
    a.observe({ id: 'w1:p1', agent: 'codex', status: 'working' })
    a.observe({ id: 'w1:p1', agent: 'codex', status: 'idle' })
    expect(a.was('w1:p1', 'codex')).toBe(true)
    a.observe({ id: 'w1:p1', agent: 'claude', status: 'idle' })
    expect(a.was('w1:p1', 'claude')).toBe(false)
    expect(a.was('w1:p1', 'codex')).toBe(false)
  })
  it('forgets a pane whose agent exited, or a pruned pane', () => {
    const a = createActivity()
    a.observe({ id: 'w1:p1', agent: 'omp', status: 'blocked' })
    a.observe({ id: 'w1:p1', agent: null, status: null })
    expect(a.was('w1:p1', 'omp')).toBe(false)
    a.observe({ id: 'w1:p2', agent: 'omp', status: 'done' })
    a.prune(id => id !== 'w1:p2')
    expect(a.was('w1:p2', 'omp')).toBe(false)
  })
})

it('integrationCommand is the documented command', () => {
  expect(integrationCommand('codex')).toBe('herdr integration install codex')
})
