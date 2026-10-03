import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { agentIcon, AGENT_ICON } from '../app/utils/agentIcons'

describe('agentIcon', () => {
  it('gives each brand agent its own logo', () => {
    expect(agentIcon('claude')).toBe('i-herdr-claude-code')
    expect(agentIcon('codex')).toBe('i-herdr-codex')
    expect(agentIcon('omp')).toBe('i-herdr-omp')
  })

  it('has no logo for unknown agents, terminals or inherited keys', () => {
    expect(agentIcon('qwen')).toBeNull()
    expect(agentIcon(null)).toBeNull()
    expect(agentIcon(undefined)).toBeNull()
    expect(agentIcon('toString')).toBeNull()
  })

  it('points every herdr icon at an SVG of the collection', () => {
    for (const name of Object.values(AGENT_ICON).filter(n => n.startsWith('i-herdr-')))
      expect(existsSync(`app/assets/icons/${name.slice('i-herdr-'.length)}.svg`), name).toBe(true)
  })
})
