import { describe, expect, it } from 'vitest'
import { agentKeys, mergeKeys, replacementPane } from '../app/utils/agentIdentity'

describe('agent identity', () => {
  it('names the conversation of a pane', () => {
    expect(agentKeys({ id: 'w7:p1', agentSession: 's1' })).toEqual(['session::s1'])
    expect(agentKeys({ id: 'w9:p1', agentSession: null })).toEqual([])
    expect(agentKeys({ id: 'ab12cd34~w1:p1', agentSession: 's2' })).toEqual(['session:ab12cd34:s2'])
  })

  it('adds keys up without duplicates, keeping the newest', () => {
    expect(mergeKeys(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(mergeKeys(['a', 'b', 'c'], ['d'], 3)).toEqual(['b', 'c', 'd'])
  })

  it('finds the pane that resumed the same conversation', () => {
    const closed = agentKeys({ id: 'w3:p1', agentSession: 's1' })
    expect(replacementPane('w3:p1', closed, [{ id: 'w3:p2', agentSession: 's1' }])?.id).toBe('w3:p2')
    expect(replacementPane('w3:p1', closed, [{ id: 'w3:p10', agentSession: 's1' }, { id: 'w3:p9', agentSession: 's1' }])?.id).toBe('w3:p10')
  })

  it('never takes another agent, another machine or nothing known', () => {
    const closed = agentKeys({ id: 'w3:p1', agentSession: 's1' })
    expect(replacementPane('w3:p1', closed, [{ id: 'w4:p1', agentSession: 's2' }])).toBeNull()
    expect(replacementPane('w3:p1', closed, [{ id: 'ab12cd34~w3:p2', agentSession: 's1' }])).toBeNull()
    expect(replacementPane('w3:p1', [], [{ id: 'w3:p2', agentSession: 's1' }])).toBeNull()
  })
})
