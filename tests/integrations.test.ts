import { describe, expect, it } from 'vitest'
import { createActivity } from '../shared/integrations'

describe('createActivity', () => {
  it('remembers an agent seen working, until another agent takes the pane', () => {
    const a = createActivity()
    a.observe({ id: 'w1:p1', agent: 'codex', status: 'idle' })
    expect(a.was('w1:p1', 'codex')).toBe(false)
    a.observe({ id: 'w1:p1', agent: 'codex', status: 'working' })
    a.observe({ id: 'w1:p1', agent: 'codex', status: 'idle' })
    expect(a.was('w1:p1', 'codex')).toBe(true)
    a.observe({ id: 'w1:p1', agent: 'claude', status: 'idle' })
    expect(a.was('w1:p1', 'claude')).toBe(false)
    expect(a.was('w1:p1', 'codex')).toBe(false)
  })
  it('forgets a pane whose agent exited, or a pruned pane', () => {
    const a = createActivity()
    a.observe({ id: 'w1:p1', agent: 'omp', status: 'blocked' })
    a.observe({ id: 'w1:p1', agent: null, status: null })
    expect(a.was('w1:p1', 'omp')).toBe(false)
    a.observe({ id: 'w1:p2', agent: 'omp', status: 'done' })
    a.prune(id => id !== 'w1:p2')
    expect(a.was('w1:p2', 'omp')).toBe(false)
  })
})
