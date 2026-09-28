import { describe, expect, it } from 'vitest'
import type { Pane, Workspace } from '../shared/types'
import { cleanLabel, conversationSubtitle, spaceTitle } from '../shared/displayTitles'

const p: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: 'agent', agent: 'claude', name: 'claude', label: null, status: 'idle', title: 'Customer portal brief', cwd: '/tmp/demo', agentSession: null }
const w: Workspace = { id: 'w1', label: 'Customer Portal 2', number: 1, status: null, worktree: false }

describe('titres du space', () => {
  it('prend toujours le nom du space pour le titre, y compris sur un thread', () => {
    expect(spaceTitle(p, w)).toBe('Customer Portal 2')
    expect(spaceTitle({ ...p, name: 'hp-demo-t-0001-task', label: 'Pane renommé' }, w)).toBe('Customer Portal 2')
  })
  it('garde le sujet de conversation en secondaire', () => {
    expect(conversationSubtitle(p, w)).toBe('Customer portal brief')
  })
  it('masque les titres redondants et génériques', () => {
    expect(conversationSubtitle({ ...p, title: 'Customer Portal 2' }, w)).toBe('')
    expect(conversationSubtitle({ ...p, title: 'Claude Code' }, w)).toBe('')
    expect(conversationSubtitle({ ...p, title: 'claude' }, w)).toBe('')
  })
})

describe('cleanLabel', () => {
  it('drops herdr-projects invisible markers', () => {
    expect(cleanLabel('Wherdr\u2800')).toBe('Wherdr')
    expect(cleanLabel('Customer Portal\u28002\u2800')).toBe('Customer Portal 2')
    expect(cleanLabel('Wherdr\u200B')).toBe('Wherdr')
    expect(cleanLabel(null)).toBe('')
  })
})

