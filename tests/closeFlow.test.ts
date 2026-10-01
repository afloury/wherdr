import { describe, expect, it } from 'vitest'
import { checkoutMessage, planClose } from '../app/utils/closeFlow'
import { spaceCall } from '../shared/spaceActions'
import type { HerdrState, Pane, Workspace } from '../shared/types'

const ws = (id: string, worktree: boolean): Workspace => ({ id, label: id, number: 1, status: null, worktree, repo: 'repo' })
const pane = (id: string, workspace: string): Pane => ({ id, workspace, tab: `${workspace}:t1`, tabLabel: '1', agent: null, name: null, label: null, status: null, title: null, cwd: '/tmp/repo', agentSession: null })
const state: HerdrState = {
  ok: true,
  workspaces: [ws('w1', false), ws('w2', true)],
  tabs: [
    { id: 'w1:t1', workspace: 'w1', label: '1', number: 1, layout: null },
    { id: 'w2:t1', workspace: 'w2', label: '1', number: 1, layout: null },
  ],
  panes: [pane('w1:p1', 'w1'), pane('w2:p1', 'w2')],
}
const tl = (_en: string, fr: string) => fr

describe('confirmation de fermeture du groupe', () => {
  it('ferme le groupe quand le dernier pane ou onglet du dépôt principal part', () => {
    for (const [kind, id] of [['pane', 'w1:p1'], ['tab', 'w1:t1'], ['workspace', 'w1']] as const) {
      const plan = planClose(state, kind, id)
      expect(plan.group).toBe(true)
      expect(plan.workspaces.map(w => w.id)).toEqual(['w1', 'w2'])
    }
    expect(spaceCall({ op: 'tab.close', tab_id: 'w1:t1', close_group: true })).toEqual({
      machine: '', method: 'workspace.close', params: { workspace_id: 'w1', close_group: true },
    })
    expect(spaceCall({ op: 'tab.close', tab_id: 'a1b2c3d4~w1:t1', close_group: true })).toEqual({
      machine: 'a1b2c3d4', method: 'workspace.close', params: { workspace_id: 'w1', close_group: true },
    })
  })

  it('garde la fermeture ordinaire pour un checkout lié ou un pane non dernier', () => {
    expect(planClose(state, 'pane', 'w2:p1').group).toBe(false)
    const more = { ...state, panes: [...state.panes, pane('w1:p2', 'w1')] }
    expect(planClose(more, 'pane', 'w1:p1').group).toBe(false)
  })

  it('annonce les fichiers conservés et les états propre et modifié', () => {
    const clean = checkoutMessage([{ label: 'main', modified: 0, untracked: 0 }], false, tl)
    expect(clean).toContain('aucune modification')
    expect(clean).toContain('branches et les dossiers')
    const dirty = checkoutMessage([{ label: 'test', modified: 2, untracked: 1 }], true, tl)
    expect(dirty).toContain('groupe de worktrees')
    expect(dirty).toContain('2 fichier(s) modifié(s), 1 non suivi(s)')
    expect(dirty).toContain('modifications non commitées conservées')
  })
})
