import { describe, expect, it } from 'vitest'
import { closeSummary, moveTargets, paneSpaceEntries, spaceCall, spaceResult } from '../shared/spaceActions'
import { reduceSnapshot } from '../server/utils/snapshot'
import layouts from './fixtures/snapshot-layouts.json'
import { closeConfirm } from '../app/utils/spaceConfirm'

const R = 'abcd1234'

describe('spaceCall', () => {
  it('nouvel onglet : jamais de focus, libellé nettoyé', () => {
    expect(spaceCall({ op: 'tab.create', workspace_id: 'w1', label: '  dev   api ' })).toEqual({
      machine: '', method: 'tab.create', params: { workspace_id: 'w1', label: 'dev api', focus: false },
    })
    expect(spaceCall({ op: 'tab.create', workspace_id: 'w2' }).params).toEqual({ workspace_id: 'w2', focus: false })
    // Dossier du nouvel onglet : chemin absolu seulement.
    expect(spaceCall({ op: 'tab.create', workspace_id: 'w2', cwd: '/home/user/dev' }).params).toEqual({ workspace_id: 'w2', cwd: '/home/user/dev', focus: false })
    expect(spaceCall({ op: 'tab.create', workspace_id: 'w2', cwd: '~/dev' }).params).toEqual({ workspace_id: 'w2', focus: false })
  })

  it('part vers la machine de l’objet, avec des IDs locaux', () => {
    expect(spaceCall({ op: 'tab.close', tab_id: `${R}~w3:t2` })).toEqual({ machine: R, method: 'tab.close', params: { tab_id: 'w3:t2' } })
    expect(spaceCall({ op: 'workspace.close', workspace_id: `${R}~w3` })).toEqual({ machine: R, method: 'workspace.close', params: { workspace_id: 'w3' } })
  })

  it('renommer : espace ou onglet, nom obligatoire et borné', () => {
    expect(spaceCall({ op: 'workspace.rename', workspace_id: 'w1', label: 'api' }).params).toEqual({ workspace_id: 'w1', label: 'api' })
    expect(spaceCall({ op: 'tab.rename', tab_id: 'w1:t2', label: 'x'.repeat(80) }).params).toEqual({ tab_id: 'w1:t2', label: 'x'.repeat(60) })
    expect(() => spaceCall({ op: 'tab.rename', tab_id: 'w1:t2', label: '   ' })).toThrow(/empty name/)
  })

  it('diviser : à droite ou en bas, sans focus', () => {
    expect(spaceCall({ op: 'pane.split', pane_id: `${R}~w1:p2`, direction: 'down' })).toEqual({
      machine: R, method: 'pane.split', params: { target_pane_id: 'w1:p2', direction: 'down', focus: false },
    })
    expect(() => spaceCall({ op: 'pane.split', pane_id: 'w1:p2', direction: 'left' })).toThrow(/direction/)
    // Dossier du nouveau pane : absolu seulement.
    expect(spaceCall({ op: 'pane.split', pane_id: 'w1:p2', direction: 'right', cwd: '/srv/app' }).params).toEqual({ target_pane_id: 'w1:p2', direction: 'right', cwd: '/srv/app', focus: false })
    expect(spaceCall({ op: 'pane.split', pane_id: 'w1:p2', direction: 'right', cwd: 'app' }).params).toEqual({ target_pane_id: 'w1:p2', direction: 'right', focus: false })
  })

  it('réordonner : avant un autre espace de la même machine, ou à la fin, sans focus', () => {
    expect(spaceCall({ op: 'workspace.move', workspace_id: `${R}~w3`, before_workspace_id: `${R}~w1` })).toEqual({
      machine: R, method: 'workspace.move_block', params: { workspace_ids: ['w3'], before_workspace_id: 'w1' },
    })
    expect(spaceCall({ op: 'workspace.move', workspace_id: 'w2', before_workspace_id: null })).toEqual({
      machine: '', method: 'workspace.move_block', params: { workspace_ids: ['w2'], before_workspace_id: null },
    })
    expect(() => spaceCall({ op: 'workspace.move', workspace_id: 'w2', before_workspace_id: `${R}~w1` })).toThrow(/another machine/)
    expect(() => spaceCall({ op: 'workspace.move', workspace_id: 'w2', before_workspace_id: 'w2' })).toThrow(/destination/)
    expect(() => spaceCall({ op: 'workspace.move', workspace_id: 'w2:p1', before_workspace_id: null })).toThrow(/invalid workspace/)
  })

  it('déplacer : vers un onglet, un nouvel onglet de son espace, un nouvel espace', () => {
    expect(spaceCall({ op: 'pane.move', pane_id: 'w1:p2', to: { tab_id: 'w2:t1' } }).params).toEqual({
      pane_id: 'w1:p2', destination: { type: 'tab', tab_id: 'w2:t1', split: 'right' }, focus: false,
    })
    expect(spaceCall({ op: 'pane.move', pane_id: `${R}~w4:p9`, to: 'new_tab' })).toEqual({
      machine: R, method: 'pane.move', params: { pane_id: 'w4:p9', destination: { type: 'new_tab', workspace_id: 'w4' }, focus: false },
    })
    expect(spaceCall({ op: 'pane.move', pane_id: 'w1:p2', to: 'new_workspace' }).params.destination).toEqual({ type: 'new_workspace' })
  })

  it('refuse un onglet d’une autre machine, des IDs ou actions inconnus', () => {
    expect(() => spaceCall({ op: 'pane.move', pane_id: 'w1:p2', to: { tab_id: `${R}~w1:t1` } })).toThrow(/another machine/)
    expect(() => spaceCall({ op: 'pane.move', pane_id: 'w1:p2', to: 'ailleurs' })).toThrow(/destination/)
    expect(() => spaceCall({ op: 'tab.close', tab_id: 'w1' })).toThrow(/invalid tab/)
    expect(() => spaceCall({ op: 'workspace.close', workspace_id: '-oProxy' })).toThrow(/invalid workspace/)
    expect(() => spaceCall({ op: 'pane.zoom', pane_id: 'w1:p1' })).toThrow(/unknown action/)
    expect(() => spaceCall(null)).toThrow(/unknown action/)
  })
})

describe('spaceResult', () => {
  it('rend les IDs créés ou déplacés, préfixés pour une machine distante', () => {
    const split = spaceCall({ op: 'pane.split', pane_id: `${R}~w1:p1`, direction: 'right' })
    expect(spaceResult(split, { type: 'pane_info', pane: { pane_id: 'w1:p2', tab_id: 'w1:t1' } })).toEqual({ pane_id: `${R}~w1:p2`, tab_id: `${R}~w1:t1` })
    const tab = spaceCall({ op: 'tab.create', workspace_id: 'w1' })
    expect(spaceResult(tab, { tab: { tab_id: 'w1:t2' }, root_pane: { pane_id: 'w1:p3' } })).toEqual({ tab_id: 'w1:t2', pane_id: 'w1:p3' })
    const move = spaceCall({ op: 'pane.move', pane_id: 'w1:p2', to: 'new_workspace' })
    expect(spaceResult(move, { move_result: { pane: { pane_id: 'w2:p1', tab_id: 'w2:t1' } } })).toEqual({ pane_id: 'w2:p1', tab_id: 'w2:t1' })
    expect(spaceResult(spaceCall({ op: 'tab.close', tab_id: 'w1:t1' }), { type: 'ok' })).toEqual({})
  })
})

const pane = (id: string, tab: string, agent: string | null = null) => ({
  pane_id: id, workspace_id: tab.split(':')[0], tab_id: tab, agent, agent_status: agent ? 'idle' : 'unknown',
})
const panes = [pane('w1:p1', 'w1:t1', 'claude'), pane('w1:p2', 'w1:t1', 'codex'), pane('w1:p3', 'w1:t1'), pane('w1:p4', 'w1:t2'), pane('w2:p1', 'w2:t1'), pane('w2:p2', 'w2:t1'), pane('w3:p1', 'w3:t1')]
const state = reduceSnapshot({ ...layouts, panes })

describe('closeSummary', () => {
  it('compte les agents qu’une fermeture arrêterait', () => {
    const s = closeSummary(state.panes.filter(p => p.tab === 'w1:t1'))
    expect(s.agents.map(p => p.agent)).toEqual(['claude', 'codex'])
    expect(s.shells).toBe(1)
    expect(closeSummary(state.panes.filter(p => p.workspace === 'w3'))).toEqual({ agents: [], shells: 1 })
  })
})

describe('moveTargets', () => {
  it('les autres onglets de la machine, ceux de son espace d’abord', () => {
    const t = moveTargets(state, 'w2:p1')
    expect(t.map(x => [x.tab_id, x.sameWorkspace])).toEqual([['w1:t1', false], ['w1:t2', false], ['w3:t1', false]])
    const u = moveTargets(state, 'w1:p4')
    expect(u.map(x => x.tab_id)).toEqual(['w1:t1', 'w2:t1', 'w3:t1'])
    expect(u[0]).toMatchObject({ label: 'dev', workspaceLabel: 'herdr-web', sameWorkspace: true, panes: 3 })
  })

  it('jamais vers une autre machine', () => {
    const remote = reduceSnapshot({ ...layouts, panes }, R)
    const both = { workspaces: [...state.workspaces, ...remote.workspaces], tabs: [...state.tabs!, ...remote.tabs!], panes: [...state.panes, ...remote.panes] }
    expect(moveTargets(both, `${R}~w1:p4`).every(x => x.tab_id.startsWith(`${R}~`))).toBe(true)
    expect(moveTargets(both, 'w1:p4').some(x => x.tab_id.includes('~'))).toBe(false)
    expect(moveTargets(both, 'w9:p9')).toEqual([])
  })
})

describe('paneSpaceEntries', () => {
  it('nouvel onglet depuis tout pane, même seul dans son espace', () => {
    // w3 : un seul onglet, un seul pane (carte d'agent, vue agent directe).
    expect(paneSpaceEntries(state, 'w3:p1')).toEqual(['tab.create', 'workspace.rename'])
  })

  it('onglets renommables et fermables quand l’espace en a plusieurs', () => {
    expect(paneSpaceEntries(state, 'w1:p4')).toEqual(['tab.create', 'tab.rename', 'tab.close', 'workspace.rename', 'workspace.close'])
  })

  it('un seul onglet de plusieurs panes : l’espace se ferme, pas l’onglet', () => {
    expect(paneSpaceEntries(state, 'w2:p2')).toEqual(['tab.create', 'workspace.rename', 'workspace.close'])
    expect(paneSpaceEntries(state, 'w9:p9')).toEqual([])
  })

  it('chaque action une seule fois (« Renommer l’espace » n’est pas en double)', () => {
    for (const p of state.panes) {
      const e = paneSpaceEntries(state, p.id)
      expect(new Set(e).size).toBe(e.length)
      expect(e.filter(x => x === 'workspace.rename')).toHaveLength(1)
    }
  })
})

describe('closeConfirm', () => {
  // Espaces insécables du français (« », : ?) : comparées comme des espaces.
  const fr = (_: string, b: string) => b.replace(/\u00a0/g, ' ')
  const en = (a: string) => a
  const tab = state.panes.filter(p => p.tab === 'w1:t1')

  it('nomme les agents qui seront arrêtés', () => {
    const c = closeConfirm({ kind: 'tab', label: 'dev', panes: tab }, fr)
    expect(closeConfirm({ kind: 'tab', label: 'dev', panes: tab }, (_: string, b: string) => b).message).toContain('«\u00a0dev\u00a0»\u00a0?')
    expect(c.message).toBe('Fermer l’onglet « dev » ? 2 agents y tournent : Claude « Claude », Codex « Codex ». Ils seront arrêtés. Son terminal sera fermé aussi.')
    expect(c.action).toBe('Fermer et arrêter 2 agents')
    expect(closeConfirm({ kind: 'tab', label: 'dev', panes: tab }, en).action).toBe('Close and stop 2 agents')
  })

  it('prévient quand le dernier onglet emporte son espace', () => {
    const c = closeConfirm({ kind: 'tab', label: '1', panes: state.panes.filter(p => p.workspace === 'w3'), lastTab: true, workspaceLabel: 'notes' }, fr)
    expect(c.message).toBe('Fermer l’onglet « 1 » ? C’est son dernier onglet : l’espace « notes » sera fermé aussi. Son terminal sera fermé.')
    expect(c.action).toBe('Fermer l’onglet')
  })

  it('espace sans agent, ou avec beaucoup d’agents', () => {
    expect(closeConfirm({ kind: 'workspace', label: 'api', panes: state.panes.filter(p => p.workspace === 'w2') }, en))
      .toEqual({ message: 'Close space “api”? Its 2 terminals will close.', action: 'Close space' })
    const many = ['claude', 'codex', 'claude', 'claude', 'codex'].map((a, i) => ({ ...tab[0]!, id: `w1:p${i}`, agent: a, name: `a${i}` }))
    const c = closeConfirm({ kind: 'workspace', label: 'x', panes: many }, fr)
    expect(c.message).toContain('5 agents y tournent : Claude « a0 », Codex « a1 », Claude « a2 » et 2 autres.')
    expect(c.action).toBe('Fermer et arrêter 5 agents')
  })
})
