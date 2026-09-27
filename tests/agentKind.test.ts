import { describe, expect, it } from 'vitest'
import { paneAgentKind, transcriptKind } from '../shared/agentKind'
import { availableAgentKinds } from '../shared/launchableAgents'

const session = (agent: string) => ({ agent_session: { agent, kind: 'id', source: `herdr:${agent}`, value: 'x' } })

describe('paneAgentKind', () => {
  it('le processus détecté par Herdr fait foi', () => {
    expect(paneAgentKind({ agent: 'claude', ...session('claude') }, { agent: 'claude' })).toBe('claude')
    expect(paneAgentKind({ agent: 'codex' }, { agent: 'claude', ...session('claude') })).toBe('codex')
  })
  it('agent fermé : la session rapportée plutôt que le type de lancement', () => {
    expect(paneAgentKind({ agent_status: 'unknown' }, { agent: 'codex', ...session('claude') })).toBe('claude')
    expect(paneAgentKind({ ...session('claude') }, { agent: 'codex' })).toBe('claude')
  })
  it('sans session : l’entrée agents, sinon rien', () => {
    expect(paneAgentKind({}, { agent: 'codex' })).toBe('codex')
    expect(paneAgentKind({}, null)).toBeNull()
    expect(paneAgentKind({})).toBeNull()
  })
  it('garde le type Herdr des autres agents', () => {
    expect(paneAgentKind({ agent: 'gemini', agent_status: 'working' }, { agent: 'codex' })).toBe('gemini')
    expect(paneAgentKind({ ...session('opencode') }, { agent: 'claude' })).toBe('opencode')
    expect(paneAgentKind({}, { agent: 'kimi' })).toBe('kimi')
  })
})

describe('availableAgentKinds', () => {
  it('ne propose que les agents Herdr installés et autorisés, dans un ordre stable', () => {
    expect(availableAgentKinds(['kimi', 'claude', 'unknown', 'opencode', 'gemini'], ['claude', 'kimi', 'gemini']))
      .toEqual(['claude', 'gemini', 'kimi'])
    expect(availableAgentKinds([], ['claude'])).toEqual([])
  })
})

describe('transcriptKind', () => {
  it('reconnaît le type au chemin', () => {
    expect(transcriptKind('/home/user/.claude/projects/-home-user-x/abc.jsonl')).toBe('claude')
    expect(transcriptKind('/Users/a/.codex/sessions/2026/09/26/rollout-x.jsonl')).toBe('codex')
    expect(transcriptKind('/tmp/x.jsonl')).toBeNull()
  })
})
