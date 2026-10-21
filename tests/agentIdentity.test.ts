import { describe, expect, it } from 'vitest'
import { agentKeys, mergeKeys, replacementPane } from '../app/utils/agentIdentity'
import type { MachineLinks } from '../shared/boardLinks'

const links = (coordPane: string | null, taskPane: string | null): MachineLinks[] => [{
  machine: '',
  coordinators: [{ level: 'top', pane: coordPane, workspace: 'w7' }, { level: 'project', repo: 'web', pane: null, workspace: 'w8' }],
  tasks: taskPane ? [{ id: 'web/3', repo: 'web', n: 3, key: 'WEB-3', title: 'x', panes: [{ id: taskPane, role: 'worker' }], workspace: 'w9', stage: 'working', progress: null, msg: '', since: null }] : [],
}]

describe('agent identity', () => {
  it('names the conversation and the board role of a pane', () => {
    expect(agentKeys({ id: 'w7:p1', agentSession: 's1' }, links('w7:p1', 'w9:p1'))).toEqual(['session::s1', 'coord::top:'])
    expect(agentKeys({ id: 'w9:p1', agentSession: null }, links('w7:p1', 'w9:p1'))).toEqual(['task::web/3:worker:'])
    expect(agentKeys({ id: 'ab12cd34~w1:p1', agentSession: 's2' })).toEqual(['session:ab12cd34:s2'])
  })

  it('adds keys up without duplicates, keeping the newest', () => {
    expect(mergeKeys(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(mergeKeys(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd'])
  })

  it('finds the new pane of a restarted coordinator', () => {
    const closed = agentKeys({ id: 'w7:p1', agentSession: 'old' }, links('w7:p1', null))
    // The board now names the new pane; its conversation is a new one.
    const panes = [{ id: 'w1:p1', agentSession: 'other' }, { id: 'w7:p4', agentSession: 'new' }]
    expect(replacementPane('w7:p1', closed, panes, links('w7:p4', null))?.id).toBe('w7:p4')
  })

  it('finds the pane that resumed the same conversation', () => {
    const closed = agentKeys({ id: 'w3:p1', agentSession: 's1' })
    expect(replacementPane('w3:p1', closed, [{ id: 'w3:p2', agentSession: 's1' }])?.id).toBe('w3:p2')
  })

  it('never takes another agent, another machine or nothing known', () => {
    const closed = agentKeys({ id: 'w3:p1', agentSession: 's1' })
    expect(replacementPane('w3:p1', closed, [{ id: 'w4:p1', agentSession: 's2' }])).toBeNull()
    expect(replacementPane('w3:p1', closed, [{ id: 'ab12cd34~w3:p2', agentSession: 's1' }])).toBeNull()
    expect(replacementPane('w3:p1', [], [{ id: 'w3:p2', agentSession: 's1' }])).toBeNull()
  })

  it('prefers the board role over a shared conversation', () => {
    const closed = agentKeys({ id: 'w7:p1', agentSession: 's1' }, links('w7:p1', null))
    const panes = [{ id: 'w7:p9', agentSession: 's1' }, { id: 'w7:p3', agentSession: 's3' }]
    expect(replacementPane('w7:p1', closed, panes, links('w7:p3', null))?.id).toBe('w7:p3')
  })
})
