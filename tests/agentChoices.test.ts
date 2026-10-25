import { describe, expect, it } from 'vitest'
import { readHiddenAgents, selectedAgentKind, startAgentChoices, visibleAgentKinds } from '../app/utils/agentChoices'

describe('choix des agents', () => {
  it('offers all installed agents by default, and keeps Terminal', () => {
    expect(visibleAgentKinds(['claude', 'codex', 'kimi'], readHiddenAgents(null)))
      .toEqual(['claude', 'codex', 'kimi', 'shell'])
    expect(visibleAgentKinds(['claude', 'codex', 'kimi'], ['kimi']))
      .toEqual(['claude', 'codex', 'shell'])
  })

  it('crosses the setting with the installations of the chosen machine', () => {
    expect(visibleAgentKinds(['codex', 'kimi'], ['kimi'])).toEqual(['codex', 'shell'])
    expect(visibleAgentKinds(['kimi'], ['kimi'])).toEqual(['shell'])
    expect(visibleAgentKinds([], [])).toEqual(['shell'])
  })

  it('falls back to the first available kind when the choice disappears', () => {
    expect(selectedAgentKind('kimi', ['claude', 'codex', 'shell'], 'codex')).toBe('claude')
    expect(selectedAgentKind('codex', ['claude', 'codex', 'shell'])).toBe('codex')
    expect(selectedAgentKind('', ['claude', 'codex', 'shell'], 'codex')).toBe('codex')
  })

  it('ignores malformed preferences and never hides Terminal', () => {
    expect(readHiddenAgents('{')).toEqual([])
    expect(readHiddenAgents('["kimi","kimi","shell",4]')).toEqual(['kimi'])
  })

  describe('a task\'s Start row', () => {
    const def = { value: 'codex/gpt-5.5', kind: 'codex' }
    const ids = (c: ReturnType<typeof startAgentChoices>) => c.map(a => a.id ?? `default:${a.label}${a.hidden ? ' (hidden)' : ''}${a.usable ? '' : ' (missing)'}`)

    it('drops unchecked agents but keeps the default first', () => {
      expect(ids(startAgentChoices({ agent: def, agents: ['claude', 'codex', 'omp', 'kimi'] }, ['omp', 'kimi'], 'default')))
        .toEqual(['default:codex/gpt-5.5', 'claude'])
    })

    it('shows an unchecked default, marked, still usable', () => {
      expect(ids(startAgentChoices({ agent: def, agents: ['claude', 'codex', 'kimi'] }, ['codex', 'kimi'], 'default')))
        .toEqual(['default:codex/gpt-5.5 (hidden)', 'claude'])
    })

    it('keeps the not-installed and unknown cases', () => {
      expect(ids(startAgentChoices({ agent: def, agents: ['claude'] }, [], 'default'))).toEqual(['default:codex/gpt-5.5 (missing)', 'claude'])
      expect(ids(startAgentChoices({ agent: def, agents: [] }, [], 'default'))).toEqual(['default:codex/gpt-5.5'])
      expect(ids(startAgentChoices({ agent: null, agents: ['claude', 'kimi'] }, ['kimi'], 'default'))).toEqual(['default:default', 'claude'])
    })
  })
})
