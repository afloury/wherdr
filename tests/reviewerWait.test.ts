import { describe, expect, it } from 'vitest'
import { reviewerWait } from '../app/utils/reviewerWait'

// WHR-75: a task whose reviewer, not its agent, shows a dialog (1.x reviewneeds).
const seen = (status: string | null, over: Record<string, unknown> = {}) => reviewerWait({
  stage: 'reviewneeds',
  reviewer: { pane: 'w1:p4' },
  panes: status ? [{ id: 'w1:p1', status: 'done' }, { id: 'w1:p4', status: status as never }] : [{ id: 'w1:p1', status: 'done' }],
  live: true,
  ...over,
})

describe('a reviewer that needs you', () => {
  it('is not a reviewer\'s wait unless the board says so', () => {
    for (const stage of ['asks', 'reviewing', 'working', undefined]) expect(seen('blocked', { stage })).toBeNull()
  })
  it('its pane waits on a dialog: open it', () => {
    expect(seen('blocked')).toBe('open')
  })
  it('its pane waits on nothing now: the board is behind', () => {
    expect(seen('working')).toBe('quiet')
    expect(seen('idle')).toBe('quiet')
  })
  it('its pane is closed: nothing to answer', () => {
    expect(seen(null)).toBe('gone')
  })
  it('wherdr cannot reach it: never the agent\'s pane instead', () => {
    expect(seen('blocked', { reviewer: { pane: null } })).toBe('away')
    expect(seen('blocked', { reviewer: null })).toBe('away')
    expect(seen('blocked', { live: false })).toBe('away')
  })
})
