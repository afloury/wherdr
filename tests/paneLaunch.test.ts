import { describe, expect, it, vi } from 'vitest'
import { createPaneBody, launchInNewPane } from '../app/utils/paneLaunch'

const agent = { kind: 'claude', prompt: 'salut', name: '' }
const tabReq = { place: { kind: 'tab' as const, workspaceId: 'ab12~w3', label: '  revue   du code ' }, cwd: '/home/user/dev', agent }
const splitReq = { place: { kind: 'split' as const, paneId: 'ab12~w3:p2', direction: 'down' as const }, cwd: '/home/user/dev', agent }

function deps(opts: { createFails?: boolean, agentFails?: boolean } = {}) {
  const calls: string[] = []
  return {
    calls,
    space: vi.fn(async (body: Record<string, unknown>) => {
      calls.push(`space:${body.op}`)
      if (opts.createFails) throw new Error('workspace introuvable')
      return body.op === 'tab.create' ? { tab_id: 'ab12~w3:t4', pane_id: 'ab12~w3:p9' } : { tab_id: 'ab12~w3:t1', pane_id: 'ab12~w3:p7' }
    }),
    agents: vi.fn(async (body: Record<string, unknown>) => {
      calls.push('agents')
      if (opts.agentFails) throw new Error('claude non installé')
      return { pane_id: String(body.pane_id) }
    }),
  }
}

describe('nouvel onglet créé seulement à la confirmation', () => {
  it('annuler (feuille fermée sans Lancer) : aucun appel', () => {
    // Ouvrir la feuille ne passe pas par launchInNewPane ; rien n'est appelé.
    const d = deps()
    expect(d.space).not.toHaveBeenCalled()
    expect(d.agents).not.toHaveBeenCalled()
  })

  it('confirmer : tab.create avec le nom et le dossier, puis lancement dans son pane', async () => {
    const d = deps()
    const r = await launchInNewPane(d, tabReq)
    expect(d.calls).toEqual(['space:tab.create', 'agents'])
    expect(d.space).toHaveBeenCalledWith({ op: 'tab.create', workspace_id: 'ab12~w3', label: 'revue du code', cwd: '/home/user/dev' })
    expect(d.agents).toHaveBeenCalledWith({ kind: 'claude', prompt: 'salut', name: '', pane_id: 'ab12~w3:p9', cwd: '/home/user/dev', worktree: false })
    expect(r).toEqual({ stage: 'done', tabId: 'ab12~w3:t4', paneId: 'ab12~w3:p9' })
  })

  it('nom vide : nom par défaut de Herdr (pas de label)', () => {
    expect(createPaneBody({ kind: 'tab', workspaceId: 'w1', label: '   ' }, '~')).toEqual({ op: 'tab.create', workspace_id: 'w1' })
  })

  it('création de l’onglet refusée : rien lancé, on reste où on est', async () => {
    const d = deps({ createFails: true })
    const r = await launchInNewPane(d, tabReq)
    expect(d.agents).not.toHaveBeenCalled()
    expect(r).toEqual({ stage: 'create', error: 'workspace introuvable' })
  })

  it('nom d’agent invalide : refusé avant de créer l’onglet', async () => {
    const d = deps()
    const r = await launchInNewPane(d, { ...tabReq, agent: { kind: 'claude', name: '9 revue' } })
    expect(d.calls).toEqual([])
    expect(r.stage).toBe('create')
  })

  it('lancement refusé : l’onglet reste (son terminal), erreur rapportée', async () => {
    const d = deps({ agentFails: true })
    const r = await launchInNewPane(d, tabReq)
    expect(r).toEqual({ stage: 'agent', tabId: 'ab12~w3:t4', paneId: 'ab12~w3:p9', error: 'claude non installé' })
  })
})

describe('division créée seulement à la confirmation', () => {
  it('annuler : aucun appel (ni pane.split ni agent)', () => {
    const d = deps()
    expect(d.space).not.toHaveBeenCalled()
    expect(d.agents).not.toHaveBeenCalled()
  })

  it('confirmer : pane.split (sens, dossier, ratio par défaut) puis l’agent dans le nouveau pane', async () => {
    const d = deps()
    const r = await launchInNewPane(d, splitReq)
    expect(d.calls).toEqual(['space:pane.split', 'agents'])
    expect(d.space).toHaveBeenCalledWith({ op: 'pane.split', pane_id: 'ab12~w3:p2', direction: 'down', cwd: '/home/user/dev' })
    expect(d.agents).toHaveBeenCalledWith({ ...agent, pane_id: 'ab12~w3:p7', cwd: '/home/user/dev', worktree: false })
    expect(r).toEqual({ stage: 'done', tabId: 'ab12~w3:t1', paneId: 'ab12~w3:p7' })
  })

  it('dossier non absolu : celui de Herdr', () => {
    expect(createPaneBody({ kind: 'split', paneId: 'w1:p1', direction: 'right' }, '~/dev')).toEqual({ op: 'pane.split', pane_id: 'w1:p1', direction: 'right' })
  })

  it('division refusée : rien lancé, la feuille reste', async () => {
    const d = deps({ createFails: true })
    const r = await launchInNewPane(d, splitReq)
    expect(d.agents).not.toHaveBeenCalled()
    expect(r.stage).toBe('create')
  })

  it('agent refusé après la division : le pane reste en terminal, erreur rapportée', async () => {
    const d = deps({ agentFails: true })
    const r = await launchInNewPane(d, splitReq)
    expect(r).toEqual({ stage: 'agent', tabId: 'ab12~w3:t1', paneId: 'ab12~w3:p7', error: 'claude non installé' })
  })
})
