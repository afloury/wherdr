import { describe, expect, it } from 'vitest'
import type { Pane } from '../shared/types'
import { paneTitle } from '../shared/paneTitle'

const pane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'w1:p1', workspace: 'w1', tab: 't1', tabLabel: null,
  agent: 'codex', name: 'codex', label: null, status: 'working',
  title: 'Read brief and act', cwd: '/tmp', agentSession: null,
  ...overrides,
})

describe('displayed pane title', () => {
  it('takes the workspace topic for a herdr-projects thread', () => {
    const thread = pane({ name: 'hp-wherdr-t-0005-changements', title: 'Read project brief' })
    expect(paneTitle(thread, 'Effort du modèle depuis le champ de saisie')).toBe('Effort du modèle depuis le champ de saisie')
    expect(paneTitle(thread, '   ')).toBe('Read project brief')
    expect(paneTitle({ ...thread, label: 'Nom choisi' }, 'Effort du modèle')).toBe('Nom choisi')
  })

  it('recognizes a remote thread by its path when its name changed', () => {
    const thread = pane({ name: 'codex', cwd: '/Users/alice/.herdr/worktrees/app/hp-app-t-0012-title' })
    expect(paneTitle(thread, 'Recherche globale')).toBe('Recherche globale')
  })

  it('keeps the current title of other agents and of the coordinator', () => {
    expect(paneTitle(pane({ label: 'Mon agent' }), 'Workspace')).toBe('Mon agent')
    expect(paneTitle(pane({ title: 'Corriger le menu | codex' }), 'Workspace')).toBe('Corriger le menu')
    expect(paneTitle(pane({ name: 'coordinator', cwd: '/home/user/.herdr-projects/wherdr' }), 'Projet wherdr')).toBe('Read brief and act')
  })
})

describe('name of a pane in a space with several panes', () => {
  const shell = (o: Partial<Pane> = {}) => pane({ agent: null, name: null, status: null, title: 'user@host: ~/src/demo-app', cwd: '/srv/src/demo-app', ...o })

  it('prefers the chosen name, even without any other title', () => {
    expect(paneTitle(shell({ label: 'Serveur', command: 'pnpm dev' }), 'demo-app')).toBe('Serveur')
  })
  it('takes the agent name shown by Herdr, unless it is generic', () => {
    expect(paneTitle(pane({ displayAgent: 'Relecteur', title: 'Autre chose' }))).toBe('Relecteur')
    expect(paneTitle(pane({ displayAgent: 'Codex', title: 'Corriger le menu' }))).toBe('Corriger le menu')
    expect(paneTitle(pane({ agent: 'claude', name: 'claude', displayAgent: 'Claude Code', title: 'Claude Code' }))).toBe('Claude')
  })
  it('garde un titre de terminal parlant', () => {
    expect(paneTitle(shell({ title: 'htop' }))).toBe('htop')
    expect(paneTitle(shell({ title: 'vim README.md', command: 'vim README.md' }))).toBe('vim README.md')
  })
  it('ignore le prompt du shell, le nom du shell, un chemin ou le dossier', () => {
    for (const title of ['user@host: ~/src/demo-app', 'bash', '-zsh', '/usr/bin/fish', '~/src/demo-app', 'demo-app', '', null]) {
      expect(paneTitle(shell({ title, command: 'pnpm dev' }))).toBe('pnpm dev')
    }
  })
  it('falls back on the folder name, never on the space name', () => {
    expect(paneTitle(shell(), 'Mon espace')).toBe('demo-app')
    expect(paneTitle(shell({ cwd: null }))).toBe('Shell')
  })
  it('goes back to the automatic title when the name is cleared', () => {
    const named = shell({ label: 'Serveur', command: 'pnpm dev' })
    expect(paneTitle({ ...named, label: null })).toBe('pnpm dev')
  })
})
