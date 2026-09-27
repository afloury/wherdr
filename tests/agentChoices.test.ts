import { describe, expect, it } from 'vitest'
import { readHiddenAgents, selectedAgentKind, visibleAgentKinds } from '../app/utils/agentChoices'

describe('choix des agents', () => {
  it('propose tous les agents installés par défaut, et garde Terminal', () => {
    expect(visibleAgentKinds(['claude', 'codex', 'kimi'], readHiddenAgents(null)))
      .toEqual(['claude', 'codex', 'kimi', 'shell'])
    expect(visibleAgentKinds(['claude', 'codex', 'kimi'], ['kimi']))
      .toEqual(['claude', 'codex', 'shell'])
  })

  it('croise le réglage avec les installations de la machine choisie', () => {
    expect(visibleAgentKinds(['codex', 'kimi'], ['kimi'])).toEqual(['codex', 'shell'])
    expect(visibleAgentKinds(['kimi'], ['kimi'])).toEqual(['shell'])
    expect(visibleAgentKinds([], [])).toEqual(['shell'])
  })

  it('retombe sur le premier type disponible quand le choix disparaît', () => {
    expect(selectedAgentKind('kimi', ['claude', 'codex', 'shell'], 'codex')).toBe('claude')
    expect(selectedAgentKind('codex', ['claude', 'codex', 'shell'])).toBe('codex')
    expect(selectedAgentKind('', ['claude', 'codex', 'shell'], 'codex')).toBe('codex')
  })

  it('ignore les préférences mal formées et ne masque jamais Terminal', () => {
    expect(readHiddenAgents('{')).toEqual([])
    expect(readHiddenAgents('["kimi","kimi","shell",4]')).toEqual(['kimi'])
  })
})
