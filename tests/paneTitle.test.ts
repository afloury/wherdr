import { describe, expect, it } from 'vitest'
import type { Pane } from '../shared/types'
import { paneTitle } from '../shared/paneTitle'

const pane = (overrides: Partial<Pane> = {}): Pane => ({
  id: 'w1:p1', workspace: 'w1', tab: 't1', tabLabel: null,
  agent: 'codex', name: 'codex', label: null, status: 'working',
  title: 'Read brief and act', cwd: '/tmp', agentSession: null,
  ...overrides,
})

describe('titre affiché du pane', () => {
  it('prend le sujet du workspace pour un thread herdr-projects', () => {
    const thread = pane({ name: 'hp-wherdr-t-0005-changements', title: 'Read project brief' })
    expect(paneTitle(thread, 'Effort du modèle depuis le champ de saisie')).toBe('Effort du modèle depuis le champ de saisie')
    expect(paneTitle(thread, '   ')).toBe('Read project brief')
    expect(paneTitle({ ...thread, label: 'Nom choisi' }, 'Effort du modèle')).toBe('Nom choisi')
  })

  it('reconnaît un thread distant par son chemin quand son nom a changé', () => {
    const thread = pane({ name: 'codex', cwd: '/Users/alice/.herdr/worktrees/app/hp-app-t-0012-title' })
    expect(paneTitle(thread, 'Recherche globale')).toBe('Recherche globale')
  })

  it('garde le titre actuel des autres agents et du coordinateur', () => {
    expect(paneTitle(pane({ label: 'Mon agent' }), 'Workspace')).toBe('Mon agent')
    expect(paneTitle(pane({ title: 'Corriger le menu | codex' }), 'Workspace')).toBe('Corriger le menu')
    expect(paneTitle(pane({ name: 'coordinator', cwd: '/home/user/.herdr-projects/wherdr' }), 'Projet wherdr')).toBe('Read brief and act')
  })
})
