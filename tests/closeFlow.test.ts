import { describe, expect, it } from 'vitest'
import { agentsClosing, planClose, widerClose } from '../app/utils/closeFlow'
import type { HerdrState, Pane, Workspace } from '../shared/types'

const ws = (id: string): Workspace => ({ id, label: id, number: 1, status: null, worktree: false })
const pane = (id: string, workspace: string): Pane => ({ id, workspace, tab: `${workspace}:t1`, tabLabel: '1', agent: null, name: null, label: null, status: null, title: null, cwd: '/tmp/repo', agentSession: null })
describe('close scope', () => {
  const two: HerdrState = {
    ok: true,
    workspaces: [ws('w9')],
    tabs: [
      { id: 'w9:t1', workspace: 'w9', label: 'a', number: 1, layout: null },
      { id: 'w9:t2', workspace: 'w9', label: 'b', number: 2, layout: null },
    ],
    panes: [pane('w9:p1', 'w9'), pane('w9:p2', 'w9'), { ...pane('w9:p3', 'w9'), tab: 'w9:t2' }],
  }

  it('says which tabs and whether the space go with a pane', () => {
    expect(planClose(two, 'pane', 'w9:p1')).toMatchObject({ tabs: [], closesWorkspace: false })
    expect(planClose(two, 'pane', 'w9:p3')).toMatchObject({ tabs: ['w9:t2'], closesWorkspace: false })
    const lone = { ...two, panes: [two.panes[0]!], tabs: [two.tabs![0]!] }
    expect(planClose(lone, 'pane', 'w9:p1')).toMatchObject({ tabs: ['w9:t1'], closesWorkspace: true })
    expect(planClose(two, 'tab', 'w9:t1')).toMatchObject({ tabs: ['w9:t1'], closesWorkspace: false })
    expect(planClose(two, 'workspace', 'w9')).toMatchObject({ tabs: ['w9:t1', 'w9:t2'], closesWorkspace: true })
    expect(planClose(two, 'workspace', 'w9').panes).toHaveLength(3)
  })

  it('detects a close that grew while it was being confirmed', () => {
    const shown = planClose(two, 'pane', 'w9:p1')
    // The other pane of the tab closed meanwhile: the tab would go too.
    const alone = { ...two, panes: two.panes.filter(p => p.id !== 'w9:p2') }
    expect(widerClose(shown, planClose(alone, 'pane', 'w9:p1'))).toBe(true)
    // A pane added to the space: closing the space takes more.
    const space = planClose(two, 'workspace', 'w9')
    const more = { ...two, panes: [...two.panes, { ...pane('w9:p4', 'w9'), tab: 'w9:t2' }] }
    expect(widerClose(space, planClose(more, 'workspace', 'w9'))).toBe(true)
    // Unchanged, or narrower: no new confirmation.
    expect(widerClose(shown, planClose(two, 'pane', 'w9:p1'))).toBe(false)
    expect(widerClose(space, planClose({ ...two, panes: two.panes.slice(0, 2), tabs: [two.tabs![0]!] }, 'workspace', 'w9'))).toBe(false)
  })
})

describe('agents interrupted by a close', () => {
  const tl = (en: string) => en
  const agent = (id: string, status: Pane['status']): Pane => ({ ...pane(id, 'w1'), agent: 'claude', status })
  it('counts every agent of the plan, whatever its status', () => {
    expect(agentsClosing({ panes: [pane('w1:p1', 'w1')] }, tl)).toBe('')
    expect(agentsClosing({ panes: [agent('w1:p1', 'working')] }, tl)).toBe('⚠ 1 agent will be interrupted.')
    expect(agentsClosing({ panes: [agent('w1:p1', 'working'), agent('w1:p2', 'unknown'), pane('w1:p3', 'w1'), agent('w1:p4', null)] }, tl)).toBe('⚠ 3 agents will be interrupted.')
  })
})
